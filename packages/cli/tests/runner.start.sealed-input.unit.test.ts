import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  constants,
  createCipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
  RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
} from "@clawlets/core/lib/runtime/runner-command-policy-args";
import {
  loadOrCreateRunnerSealedInputKeypair,
  RUNNER_SEALED_INPUT_ALG,
} from "../src/commands/runner/sealed-input.js";

let originalPathEnv: string | undefined;
let fakeNixDir: string | undefined;

beforeAll(async () => {
  originalPathEnv = process.env.PATH;
  fakeNixDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-fake-nix-"));
  const nixBin = path.join(fakeNixDir, "nix");
  await fs.writeFile(nixBin, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await fs.chmod(nixBin, 0o755);
  process.env.PATH = `${fakeNixDir}${path.delimiter}${process.env.PATH || ""}`;
});

afterAll(async () => {
  if (originalPathEnv === undefined) delete process.env.PATH;
  else process.env.PATH = originalPathEnv;
  if (fakeNixDir) await fs.rm(fakeNixDir, { recursive: true, force: true });
});

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function buildEnvelope(params: {
  publicKeySpkiB64: string;
  keyId: string;
  aad: string;
  plaintext: string;
}): string {
  const pub = createPublicKey({
    key: fromBase64Url(params.publicKeySpkiB64),
    format: "der",
    type: "spki",
  });
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(Buffer.from(params.aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(params.plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapped = publicEncrypt(
    {
      key: pub,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    aesKey,
  );

  const envelope = {
    v: 1,
    alg: RUNNER_SEALED_INPUT_ALG,
    kid: params.keyId,
    iv: toBase64Url(iv),
    w: toBase64Url(wrapped),
    ct: toBase64Url(Buffer.concat([ciphertext, tag])),
  };
  return toBase64Url(Buffer.from(JSON.stringify(envelope), "utf8"));
}

async function loadRunnerStartWithMocks(params: {
  resolvedArgs: string[];
  resolvedKind?: string;
  resolvedExec?: "clawlets" | "git";
  resolvedResultMode?: "log" | "json_small" | "json_large";
  resolvedResultMaxBytes?: number;
  captureOutput?: string;
  mockNixBin?: string | null;
}) {
  vi.resetModules();
  const observed: { tempPath?: string; tempJson?: string; env?: Record<string, unknown>; stdin?: unknown } = {};

  const inspectTempPath = async (argv: string[]) => {
    for (const token of argv) {
      if (typeof token !== "string") continue;
      if (!token.includes("clawlets-runner-input.") && !token.includes("clawlets-runner-secrets.")) continue;
      observed.tempPath = token;
      observed.tempJson = await fs.readFile(token, "utf8");
      break;
    }
  };

  const execCaptureTail = vi.fn(async (args: any) => {
    observed.env = args?.env;
    observed.stdin = args?.stdin;
    await inspectTempPath(Array.isArray(args?.args) ? args.args : []);
    return {
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdoutTail: "",
      stderrTail: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  });
  const execCaptureStdout = vi.fn(async (args: any) => {
    observed.env = args?.env;
    observed.stdin = args?.stdin;
    await inspectTempPath(Array.isArray(args?.args) ? args.args : []);
    return {
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdout: params.captureOutput || "",
      stderrTail: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  });

  vi.doMock("../src/commands/runner/exec.js", () => ({ execCaptureTail, execCaptureStdout }));
  vi.doMock("@clawlets/core/lib/nix/nix-bin", () => ({
    resolveNixBin: vi.fn(() => (params.mockNixBin === undefined ? "/usr/bin/nix" : params.mockNixBin)),
  }));
  vi.doMock("@clawlets/core/lib/runtime/runner-command-policy-resolve", () => ({
    resolveRunnerJobCommand: vi.fn(async () => ({
      ok: true,
      kind: params.resolvedKind || "custom",
      exec: params.resolvedExec || "clawlets",
      args: params.resolvedArgs,
      resultMode: params.resolvedResultMode || "log",
      resultMaxBytes: params.resolvedResultMaxBytes,
    })),
  }));

  const mod = await import("../src/commands/runner/start.js");
  return { mod, execCaptureTail, execCaptureStdout, observed };
}

function jsonObjectWithExactBytes(maxBytes: number): string {
  const prefix = "{\"x\":\"";
  const suffix = "\"}";
  const overhead = Buffer.byteLength(prefix + suffix, "utf8");
  if (maxBytes < overhead) throw new Error(`maxBytes must be >= ${overhead}`);
  return `${prefix}${"a".repeat(maxBytes - overhead)}${suffix}`;
}

function runEventMessages(appendRunEvents: { mock: { calls: Array<any[]> } }): string[] {
  return appendRunEvents.mock.calls.flatMap((call: any[]) =>
    (call?.[0]?.events || []).map((event: any) => String(event?.message || "")),
  );
}

describe("runner sealed input execution", () => {
  it("decrypts sealed input, writes temp JSON, substitutes args, and executes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-start-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });

      const projectId = "p1";
      const targetRunnerId = "r1";
      const jobId = "job1";
      const kind = "custom";
      const aad = `${projectId}:${jobId}:${kind}:${targetRunnerId}`;
      const plaintext = JSON.stringify({ HCLOUD_TOKEN: "token-123" });
      const sealedInputB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad,
        plaintext,
      });

      const { mod, execCaptureTail, execCaptureStdout, observed } = await loadRunnerStartWithMocks({
        resolvedArgs: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__"],
      });

      await expect(
        mod.__test_executeJob({
          job: {
            jobId,
            runId: "run1",
            leaseId: "lease1",
            leaseExpiresAt: Date.now() + 30_000,
            kind,
            attempt: 1,
            targetRunnerId,
            sealedInputB64,
            sealedInputAlg: RUNNER_SEALED_INPUT_ALG,
            sealedInputKeyId: keypair.keyId,
            payloadMeta: { args: ["doctor"], updatedKeys: ["HCLOUD_TOKEN"] },
          },
          repoRoot: "/tmp/repo",
          projectId,
          runnerPrivateKeyPem: keypair.privateKeyPem,
        }),
      ).resolves.toEqual({});

      expect(execCaptureStdout).not.toHaveBeenCalled();
      expect(execCaptureTail).toHaveBeenCalledTimes(1);
      expect(execCaptureTail.mock.calls[0]?.[0]?.stdin).toBe("ignore");
      expect(execCaptureTail.mock.calls[0]?.[0]?.maxStdoutBytes).toBe(0);
      expect(execCaptureTail.mock.calls[0]?.[0]?.maxStderrBytes).toBe(0);
      expect(observed.env?.["CI"]).toBe("1");
      expect(observed.env?.["CLAWLETS_NON_INTERACTIVE"]).toBe("1");
      expect(observed.stdin).toBe("ignore");

      expect(observed.tempPath).toBeTruthy();
      expect(observed.tempJson).toBeTruthy();
      const parsed = JSON.parse(String(observed.tempJson || "{}")) as Record<string, string>;
      expect(parsed).toMatchObject({ HCLOUD_TOKEN: "token-123" });

      // temp file should be cleaned up after execution
      await expect(fs.stat(String(observed.tempPath))).rejects.toThrow();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails fast when placeholder job is missing sealed input", async () => {
    const { mod, execCaptureTail, execCaptureStdout } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__"],
    });

    await expect(
      mod.__test_executeJob({
        job: {
          jobId: "job1",
          runId: "run1",
          leaseId: "lease1",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          targetRunnerId: "r1",
          // sealedInputB64 intentionally missing
          payloadMeta: { args: ["doctor"], updatedKeys: ["HCLOUD_TOKEN"] },
        },
        repoRoot: "/tmp/repo",
        projectId: "p1",
        runnerPrivateKeyPem: "pem",
      }),
    ).rejects.toThrow(/sealed input missing for placeholder job/i);

    expect(execCaptureTail).not.toHaveBeenCalled();
    expect(execCaptureStdout).not.toHaveBeenCalled();
  });

  it("fails when placeholder appears more than once", async () => {
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__", "--from-json", "__RUNNER_INPUT_JSON__"],
    });

    await expect(
      mod.__test_executeJob({
        job: {
          jobId: "job-dup-placeholder",
          runId: "run-dup-placeholder",
          leaseId: "lease-dup-placeholder",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__"], updatedKeys: ["HCLOUD_TOKEN"] },
        },
        repoRoot: "/tmp/repo",
        projectId: "p1",
        runnerPrivateKeyPem: "pem",
      }),
    ).rejects.toThrow(/more than once/i);
  });

  it("fails when args include both placeholders", async () => {
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "apply-json", "__RUNNER_SECRETS_JSON__", "__RUNNER_INPUT_JSON__"],
    });

    await expect(
      mod.__test_executeJob({
        job: {
          jobId: "job-both-placeholders",
          runId: "run-both-placeholders",
          leaseId: "lease-both-placeholders",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["env", "apply-json"] },
        },
        repoRoot: "/tmp/repo",
        projectId: "p1",
        runnerPrivateKeyPem: "pem",
      }),
    ).rejects.toThrow(/cannot include both __RUNNER_SECRETS_JSON__ and __RUNNER_INPUT_JSON__/i);
  });

  it("fails fast for nix-required jobs when nix is unavailable", async () => {
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["doctor"],
      resolvedKind: "doctor",
      mockNixBin: null,
    });

    await expect(
      mod.__test_executeJob({
        job: {
          jobId: "job-nix-required",
          runId: "run-nix-required",
          leaseId: "lease-nix-required",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "doctor",
          attempt: 1,
          payloadMeta: { args: ["doctor"] },
        },
        repoRoot: "/tmp/repo",
        projectId: "p1",
        runnerPrivateKeyPem: "pem",
      }),
    ).rejects.toThrow(/nix not found/i);
  });

  it("binds secrets_write sealed payload to reserved jobId and suppresses local output", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-start-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const projectId = "p1";
      const targetRunnerId = "r1";
      const kind = "secrets_write";
      const plaintext = JSON.stringify({ DISCORD_TOKEN: "token-123" });
      const jobA = "job-a";
      const sealedInputB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad: `${projectId}:${jobA}:${kind}:${targetRunnerId}`,
        plaintext,
      });

      const { mod, execCaptureTail, observed } = await loadRunnerStartWithMocks({
        resolvedKind: kind,
        resolvedArgs: ["secrets", "init", "--host", "alpha", "--scope", "all", "--from-json", "__RUNNER_SECRETS_JSON__", "--yes"],
      });

      await expect(
        mod.__test_executeJob({
          job: {
            jobId: jobA,
            runId: "run-a",
            leaseId: "lease-a",
            leaseExpiresAt: Date.now() + 30_000,
            kind,
            attempt: 1,
            targetRunnerId,
            sealedInputB64,
            sealedInputAlg: RUNNER_SEALED_INPUT_ALG,
            sealedInputKeyId: keypair.keyId,
            payloadMeta: { secretNames: ["DISCORD_TOKEN"] },
          },
          repoRoot: "/tmp/repo",
          projectId,
          runnerPrivateKeyPem: keypair.privateKeyPem,
        }),
      ).resolves.toEqual({});
      expect(execCaptureTail).toHaveBeenCalledTimes(1);
      expect(execCaptureTail.mock.calls[0]?.[0]?.stdin).toBe("ignore");
      expect(execCaptureTail.mock.calls[0]?.[0]?.maxStdoutBytes).toBe(0);
      expect(execCaptureTail.mock.calls[0]?.[0]?.maxStderrBytes).toBe(0);

      expect(observed.tempPath).toBeTruthy();
      expect(observed.tempJson).toBeTruthy();
      const tempBody = JSON.parse(String(observed.tempJson || "{}")) as any;
      expect(tempBody).toMatchObject({ secrets: { DISCORD_TOKEN: "token-123" } });

      await expect(
        mod.__test_executeJob({
          job: {
            jobId: "job-b",
            runId: "run-b",
            leaseId: "lease-b",
            leaseExpiresAt: Date.now() + 30_000,
            kind,
            attempt: 1,
            targetRunnerId,
            sealedInputB64,
            sealedInputAlg: RUNNER_SEALED_INPUT_ALG,
            sealedInputKeyId: keypair.keyId,
            payloadMeta: { secretNames: ["DISCORD_TOKEN"] },
          },
          repoRoot: "/tmp/repo",
          projectId,
          runnerPrivateKeyPem: keypair.privateKeyPem,
        }),
      ).rejects.toThrow();
      expect(execCaptureTail).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes tailscaleAuthKey as a top-level secrets init field (not a managed secret)", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-start-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const projectId = "p1";
      const targetRunnerId = "r1";
      const kind = "secrets_write";
      const jobId = "job-tailscale";
      const plaintext = JSON.stringify({ tailscaleAuthKey: "tskey-auth-abc123" });
      const sealedInputB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad: `${projectId}:${jobId}:${kind}:${targetRunnerId}`,
        plaintext,
      });

      const { mod, observed } = await loadRunnerStartWithMocks({
        resolvedKind: kind,
        resolvedArgs: ["secrets", "init", "--host", "alpha", "--scope", "all", "--from-json", "__RUNNER_SECRETS_JSON__", "--yes"],
      });

      await expect(
        mod.__test_executeJob({
          job: {
            jobId,
            runId: "run-tailscale",
            leaseId: "lease-tailscale",
            leaseExpiresAt: Date.now() + 30_000,
            kind,
            attempt: 1,
            targetRunnerId,
            sealedInputB64,
            sealedInputAlg: RUNNER_SEALED_INPUT_ALG,
            sealedInputKeyId: keypair.keyId,
            payloadMeta: { secretNames: ["tailscale_auth_key"] },
          },
          repoRoot: "/tmp/repo",
          projectId,
          runnerPrivateKeyPem: keypair.privateKeyPem,
        }),
      ).resolves.toEqual({});

      expect(observed.tempPath).toBeTruthy();
      expect(observed.tempJson).toBeTruthy();
      const tempBody = JSON.parse(String(observed.tempJson || "{}")) as any;
      expect(tempBody).toMatchObject({ tailscaleAuthKey: "tskey-auth-abc123", secrets: {} });
      expect(tempBody?.secrets?.tailscaleAuthKey).toBeUndefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("unseals setup_apply nested drafts into final input JSON and returns structured summary", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-start-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const projectId = "p1";
      const targetRunnerId = "r1";
      const hostName = "alpha";
      const jobId = "job-setup-apply";
      const kind = "setup_apply";

      const hostBootstrapCredsDraft = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad: `${projectId}:${hostName}:setupDraft:hostBootstrapCreds:${targetRunnerId}`,
        plaintext: JSON.stringify({
          HCLOUD_TOKEN: "token-123",
          GITHUB_TOKEN: "gh-123",
          SOPS_AGE_KEY_FILE: "/tmp/operator.agekey",
        }),
      });
      const hostBootstrapSecretsDraft = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad: `${projectId}:${hostName}:setupDraft:hostBootstrapSecrets:${targetRunnerId}`,
        plaintext: JSON.stringify({
          adminPasswordHash: "$6$hash",
          discord_token: "token-xyz",
        }),
      });
      const outerPayload = {
        hostName,
        configOps: [
          {
            path: "hosts.alpha.provisioning.provider",
            value: "hetzner",
            del: false,
          },
        ],
        hostBootstrapCredsDraft: {
          alg: RUNNER_SEALED_INPUT_ALG,
          keyId: keypair.keyId,
          targetRunnerId,
          sealedInputB64: hostBootstrapCredsDraft,
          aad: `${projectId}:${hostName}:setupDraft:hostBootstrapCreds:${targetRunnerId}`,
          updatedAt: 1,
          expiresAt: Date.now() + 60_000,
        },
        hostBootstrapSecretsDraft: {
          alg: RUNNER_SEALED_INPUT_ALG,
          keyId: keypair.keyId,
          targetRunnerId,
          sealedInputB64: hostBootstrapSecretsDraft,
          aad: `${projectId}:${hostName}:setupDraft:hostBootstrapSecrets:${targetRunnerId}`,
          updatedAt: 1,
          expiresAt: Date.now() + 60_000,
        },
      };
      const sealedInputB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad: `${projectId}:${jobId}:${kind}:${targetRunnerId}`,
        plaintext: JSON.stringify(outerPayload),
      });

      const { mod, execCaptureTail, execCaptureStdout, observed } = await loadRunnerStartWithMocks({
        resolvedKind: kind,
        resolvedArgs: ["setup", "apply", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
        resolvedResultMode: "json_small",
        captureOutput: "{\"ok\":true,\"summary\":\"safe\"}",
      });

      await expect(
        mod.__test_executeJob({
          job: {
            jobId,
            runId: "run-setup-apply",
            leaseId: "lease-setup-apply",
            leaseExpiresAt: Date.now() + 30_000,
            kind,
            attempt: 1,
            targetRunnerId,
            sealedInputB64,
            sealedInputAlg: RUNNER_SEALED_INPUT_ALG,
            sealedInputKeyId: keypair.keyId,
            payloadMeta: {
              args: ["setup", "apply", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
              updatedKeys: ["hostName", "configOps", "hostBootstrapCredsDraft", "hostBootstrapSecretsDraft"],
            },
          },
          repoRoot: "/tmp/repo",
          projectId,
          runnerPrivateKeyPem: keypair.privateKeyPem,
        }),
      ).resolves.toEqual({
        commandResultJson: "{\"ok\":true,\"summary\":\"safe\"}",
      });

      expect(execCaptureTail).not.toHaveBeenCalled();
      expect(execCaptureStdout).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(String(observed.tempJson || "{}")) as Record<string, unknown>;
      expect(parsed.hostName).toBe(hostName);
      expect(parsed).toMatchObject({
        deployCreds: {
          HCLOUD_TOKEN: "token-123",
          GITHUB_TOKEN: "gh-123",
        },
        bootstrapSecrets: {
          adminPasswordHash: "$6$hash",
          discord_token: "token-xyz",
        },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not append command_output events for setup_apply secret-bearing runs", async () => {
    const appendRunEvents = vi.fn(async () => ({ ok: true }));
    const result = await (await import("../src/commands/runner/start.js")).__test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents } as any,
      projectId: "p1",
      job: {
        jobId: "job-setup-output",
        runId: "run-setup-output",
        leaseId: "lease-setup-output",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "setup_apply",
        attempt: 1,
      },
      maxAttempts: 3,
      executeJobFn: vi.fn(async () => ({
        commandResultJson: "{\"ok\":true}",
      })),
    });

    expect(result).toEqual({
      terminal: "succeeded",
      commandResultJson: "{\"ok\":true}",
      commandResultLargeJson: undefined,
    });
    expect(appendRunEvents.mock.calls).toHaveLength(2);
    const messages = runEventMessages(appendRunEvents);
    expect(messages.some((message) => message.includes("structured JSON result stored ephemerally"))).toBe(false);
    expect(messages.some((message) => message.includes("{\"ok\":true}"))).toBe(false);
  });

  it("returns machine JSON via commandResultJson and redacts run-event output", async () => {
    const { mod, execCaptureTail, execCaptureStdout } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "show", "--json"],
      resolvedResultMode: "json_small",
      captureOutput: "{\n  \"ok\": true,\n  \"value\": \"x\"\n}\n",
    });

    await expect(
      mod.__test_executeJob({
        job: {
          jobId: "job-json",
          runId: "run-json",
          leaseId: "lease-json",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["env", "show", "--json"] },
        },
        repoRoot: "/tmp/repo",
        projectId: "p1",
        runnerPrivateKeyPem: "pem",
      }),
    ).resolves.toEqual({
      redactedOutput: true,
      commandResultJson: "{\"ok\":true,\"value\":\"x\"}",
    });

    expect(execCaptureTail).not.toHaveBeenCalled();
    expect(execCaptureStdout).toHaveBeenCalledTimes(1);
  });

  it("accepts json_small payload exactly at byte limit", async () => {
    const payload = jsonObjectWithExactBytes(RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES);
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "show", "--json"],
      resolvedResultMode: "json_small",
      captureOutput: payload,
    });

    const result = await mod.__test_executeJob({
      job: {
        jobId: "job-json-small-limit",
        runId: "run-json-small-limit",
        leaseId: "lease-json-small-limit",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["env", "show", "--json"] },
      },
      repoRoot: "/tmp/repo",
      projectId: "p1",
      runnerPrivateKeyPem: "pem",
    });

    expect(result.commandResultJson).toBe(payload);
    expect(Buffer.byteLength(String(result.commandResultJson || ""), "utf8")).toBe(
      RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
    );
  });

  it("fails closed when json_small payload exceeds byte limit", async () => {
    const payload = jsonObjectWithExactBytes(RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES + 1);
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "show", "--json"],
      resolvedResultMode: "json_small",
      captureOutput: payload,
    });
    const appendRunEvents = vi.fn(async () => ({ ok: true }));

    const result = await mod.__test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents } as any,
      projectId: "p1",
      job: {
        jobId: "job-json-small-over",
        runId: "run-json-small-over",
        leaseId: "lease-json-small-over",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["env", "show", "--json"] },
      },
      maxAttempts: 3,
      executeJobFn: mod.__test_executeJob,
    });

    expect(result.terminal).toBe("failed");
    expect(result.commandResultJson).toBeUndefined();
    const messages = runEventMessages(appendRunEvents);
    expect(messages.some((message) => message.includes("\"x\":\""))).toBe(false);
  });

  it("emits only redaction marker in run-events for real structured executeJob", async () => {
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "show", "--json"],
      resolvedResultMode: "json_small",
      captureOutput: "{\"ok\":true}",
    });
    const appendRunEvents = vi.fn(async () => ({ ok: true }));

    const result = await mod.__test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents } as any,
      projectId: "p1",
      job: {
        jobId: "job-run-events",
        runId: "run-run-events",
        leaseId: "lease-run-events",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["env", "show", "--json"] },
      },
      maxAttempts: 3,
      executeJobFn: mod.__test_executeJob,
    });

    expect(result).toEqual({
      terminal: "succeeded",
      commandResultJson: "{\"ok\":true}",
    });
    const events = appendRunEvents.mock.calls.flatMap((call: any[]) => call?.[0]?.events || []);
    expect(events.some((event: any) => event?.redacted === true)).toBe(true);
    expect(events.some((event: any) => String(event?.message || "").includes("{\"ok\":true}"))).toBe(false);
  });

  it("fails closed when structured output is non-JSON", async () => {
    const rawOutput = "not-json output";
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["env", "show", "--json"],
      resolvedResultMode: "json_small",
      captureOutput: rawOutput,
    });
    const appendRunEvents = vi.fn(async () => ({ ok: true }));

    const result = await mod.__test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents } as any,
      projectId: "p1",
      job: {
        jobId: "job-json-invalid",
        runId: "run-json-invalid",
        leaseId: "lease-json-invalid",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["env", "show", "--json"] },
      },
      maxAttempts: 3,
      executeJobFn: mod.__test_executeJob,
    });

    expect(result.terminal).toBe("failed");
    expect(result.commandResultJson).toBeUndefined();
    const messages = runEventMessages(appendRunEvents);
    expect(messages.some((message) => message.includes(rawOutput))).toBe(false);
  });

  it("returns large structured JSON via commandResultLargeJson", async () => {
    const { mod, execCaptureTail, execCaptureStdout } = await loadRunnerStartWithMocks({
      resolvedArgs: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"],
      resolvedResultMode: "json_large",
      resolvedResultMaxBytes: 5 * 1024 * 1024,
      captureOutput: "{\"ok\":true,\"schema\":{\"name\":\"x\"}}",
    });

    await expect(
      mod.__test_executeJob({
        job: {
          jobId: "job-json-large",
          runId: "run-json-large",
          leaseId: "lease-json-large",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"] },
        },
        repoRoot: "/tmp/repo",
        projectId: "p1",
        runnerPrivateKeyPem: "pem",
      }),
    ).resolves.toEqual({
      redactedOutput: true,
      commandResultLargeJson: "{\"ok\":true,\"schema\":{\"name\":\"x\"}}",
    });

    expect(execCaptureTail).not.toHaveBeenCalled();
    expect(execCaptureStdout).toHaveBeenCalledTimes(1);
  });

  it("accepts json_large payload exactly at byte limit", async () => {
    const payload = jsonObjectWithExactBytes(RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES);
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"],
      resolvedResultMode: "json_large",
      resolvedResultMaxBytes: RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
      captureOutput: payload,
    });

    const result = await mod.__test_executeJob({
      job: {
        jobId: "job-json-large-limit",
        runId: "run-json-large-limit",
        leaseId: "lease-json-large-limit",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"] },
      },
      repoRoot: "/tmp/repo",
      projectId: "p1",
      runnerPrivateKeyPem: "pem",
    });

    expect(result.commandResultLargeJson).toBe(payload);
    expect(Buffer.byteLength(String(result.commandResultLargeJson || ""), "utf8")).toBe(
      RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
    );
  });

  it("emits only redaction marker in run-events for json_large structured executeJob", async () => {
    const payload = "{\"ok\":true,\"schema\":{\"token\":\"sensitive\"}}";
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"],
      resolvedResultMode: "json_large",
      resolvedResultMaxBytes: RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
      captureOutput: payload,
    });
    const appendRunEvents = vi.fn(async () => ({ ok: true }));

    const result = await mod.__test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents } as any,
      projectId: "p1",
      job: {
        jobId: "job-run-events-large",
        runId: "run-run-events-large",
        leaseId: "lease-run-events-large",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"] },
      },
      maxAttempts: 3,
      executeJobFn: mod.__test_executeJob,
    });

    expect(result).toEqual({
      terminal: "succeeded",
      commandResultLargeJson: payload,
    });
    const messages = runEventMessages(appendRunEvents);
    expect(messages.some((message) => message.includes("structured JSON result stored ephemerally"))).toBe(true);
    expect(messages.some((message) => message.includes(payload))).toBe(false);
  });

  it("fails closed when json_large payload exceeds byte limit", async () => {
    const payload = jsonObjectWithExactBytes(RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES + 1);
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"],
      resolvedResultMode: "json_large",
      resolvedResultMaxBytes: RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
      captureOutput: payload,
    });
    const appendRunEvents = vi.fn(async () => ({ ok: true }));

    const result = await mod.__test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents } as any,
      projectId: "p1",
      job: {
        jobId: "job-json-large-over",
        runId: "run-json-large-over",
        leaseId: "lease-json-large-over",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"] },
      },
      maxAttempts: 3,
      executeJobFn: mod.__test_executeJob,
    });

    expect(result.terminal).toBe("failed");
    expect(result.commandResultLargeJson).toBeUndefined();
    const messages = runEventMessages(appendRunEvents);
    expect(messages.some((message) => message.includes("\"x\":\""))).toBe(false);
  });

  it("fails closed when json_large output has trailing noise", async () => {
    const rawOutput = "{\"ok\":true}\ntrailing noise";
    const { mod } = await loadRunnerStartWithMocks({
      resolvedArgs: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"],
      resolvedResultMode: "json_large",
      resolvedResultMaxBytes: RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
      captureOutput: rawOutput,
    });
    const appendRunEvents = vi.fn(async () => ({ ok: true }));

    const result = await mod.__test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents } as any,
      projectId: "p1",
      job: {
        jobId: "job-json-large-trailing",
        runId: "run-json-large-trailing",
        leaseId: "lease-json-large-trailing",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"] },
      },
      maxAttempts: 3,
      executeJobFn: mod.__test_executeJob,
    });

    expect(result.terminal).toBe("failed");
    expect(result.commandResultLargeJson).toBeUndefined();
    const messages = runEventMessages(appendRunEvents);
    expect(messages.some((message) => message.includes("trailing noise"))).toBe(false);
  });

  it("executes git jobs with stdin disabled", async () => {
    const { mod, execCaptureTail, execCaptureStdout, observed } = await loadRunnerStartWithMocks({
      resolvedArgs: ["status"],
      resolvedKind: "project_import",
      resolvedExec: "git",
    });

    await expect(
      mod.__test_executeJob({
        job: {
          jobId: "job-git",
          runId: "run-git",
          leaseId: "lease-git",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "project_import",
          attempt: 1,
          payloadMeta: { repoUrl: "https://example.com/repo.git" },
        },
        repoRoot: "/tmp/repo",
        projectId: "p1",
        runnerPrivateKeyPem: "pem",
      }),
    ).resolves.toEqual({});

    expect(execCaptureTail).toHaveBeenCalledTimes(1);
    expect(execCaptureTail.mock.calls[0]?.[0]?.cmd).toBe("git");
    expect(execCaptureTail.mock.calls[0]?.[0]?.args).toEqual(["status"]);
    expect(execCaptureStdout).not.toHaveBeenCalled();
    expect(observed.stdin).toBe("ignore");
  });
});
