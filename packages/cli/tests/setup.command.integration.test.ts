import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findRepoRootMock = vi.hoisted(() => vi.fn());
const loadFullConfigMock = vi.hoisted(() => vi.fn());
const writeClawletsConfigMock = vi.hoisted(() => vi.fn());
const updateDeployCredsEnvFileMock = vi.hoisted(() => vi.fn());
const loadDeployCredsMock = vi.hoisted(() => vi.fn());
const resolveActiveDeployCredsProjectTokenMock = vi.hoisted(() => vi.fn());
const runMock = vi.hoisted(() => vi.fn());
const captureMock = vi.hoisted(() => vi.fn());

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/config/clawlets-config", () => ({
  ClawletsConfigSchema: {
    parse: (value: unknown) => value,
  },
  loadFullConfig: loadFullConfigMock,
  writeClawletsConfig: writeClawletsConfigMock,
}));

vi.mock("@clawlets/core/lib/infra/deploy-creds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clawlets/core/lib/infra/deploy-creds")>();
  return {
    ...actual,
    updateDeployCredsEnvFile: updateDeployCredsEnvFileMock,
    loadDeployCreds: loadDeployCredsMock,
    resolveActiveDeployCredsProjectToken: resolveActiveDeployCredsProjectTokenMock,
  };
});

vi.mock("@clawlets/core/lib/runtime/run", () => ({
  run: runMock,
  capture: captureMock,
}));

describe("setup apply command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadDeployCredsMock.mockReturnValue({
      values: {
        TAILSCALE_AUTH_KEY_KEYRING: "",
        TAILSCALE_AUTH_KEY_KEYRING_ACTIVE: "",
      },
    });
    resolveActiveDeployCredsProjectTokenMock.mockReturnValue(undefined);
  });

  it("applies config + deploy creds + secrets in order and prints redacted summary", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    const order: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: { hosts: { alpha: {} }, fleet: {} },
        infraConfigPath: configPath,
      });
      writeClawletsConfigMock.mockImplementation(async () => {
        order.push("config");
      });
      updateDeployCredsEnvFileMock.mockImplementation(async () => {
        order.push("deployCreds");
        return { updatedKeys: ["HCLOUD_TOKEN", "GITHUB_TOKEN"] };
      });
      runMock.mockImplementation(async () => {
        order.push("secretsInit");
      });
      captureMock.mockImplementation(async () => {
        order.push("secretsVerify");
        return JSON.stringify({
          results: [{ status: "ok" }, { status: "missing" }, { status: "warn" }],
        });
      });

      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              HCLOUD_TOKEN: "token-123",
              GITHUB_TOKEN: "gh-123",
              NOPE: "ignored",
            },
            bootstrapSecrets: {
              adminPasswordHash: "$6$hash",
              discord_token: "discord-raw",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await apply.run({ args: { fromJson: inputPath, json: true } } as any);

      expect(order).toEqual(["config", "deployCreds", "secretsInit", "secretsVerify"]);
      expect(writeClawletsConfigMock).toHaveBeenCalledTimes(1);
      expect(updateDeployCredsEnvFileMock).toHaveBeenCalledTimes(1);
      expect(runMock).toHaveBeenCalledTimes(1);
      expect(captureMock).toHaveBeenCalledTimes(1);
      const secretsInitRunOpts = runMock.mock.calls.at(0)?.[2] as Record<string, unknown> | undefined;
      expect(secretsInitRunOpts?.stdout).toBe("ignore");
      const summaryRaw = String(logSpy.mock.calls.at(-1)?.[0] || "");
      const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
      expect(summaryRaw).not.toContain("token-123");
      expect(summaryRaw).not.toContain("gh-123");
      expect(summaryRaw).not.toContain("discord-raw");
      expect((summary as any).ok).toBe(true);
      expect((summary as any).bootstrapSecrets?.verify).toEqual({
        ok: 1,
        missing: 1,
        warn: 1,
        total: 3,
      });
    } finally {
      logSpy.mockRestore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails when payload has no recognized deploy creds keys", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-fail-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: { hosts: { alpha: {} }, fleet: {} },
        infraConfigPath: configPath,
      });
      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              NOT_ALLOWED: "x",
            },
            bootstrapSecrets: {
              adminPasswordHash: "$6$hash",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await expect(apply.run({ args: { fromJson: inputPath, json: true } } as any)).rejects.toThrow(
        /no recognized deploy creds keys/i,
      );
      expect(updateDeployCredsEnvFileMock).not.toHaveBeenCalled();
      expect(runMock).not.toHaveBeenCalled();
      expect(captureMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("treats delete ops for missing config paths as no-op", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-delete-noop-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: {
          hosts: {
            alpha: {
              hetzner: {
                volumeSizeGb: 0,
              },
            },
          },
          fleet: {},
        },
        infraConfigPath: configPath,
      });
      updateDeployCredsEnvFileMock.mockResolvedValue({
        updatedKeys: ["HCLOUD_TOKEN"],
      });
      runMock.mockResolvedValue(undefined);
      captureMock.mockResolvedValue(
        JSON.stringify({
          results: [{ status: "ok" }],
        }),
      );

      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.hetzner.volumeLinuxDevice", del: true },
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              HCLOUD_TOKEN: "token-123",
            },
            bootstrapSecrets: {},
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await apply.run({ args: { fromJson: inputPath, json: true } } as any);

      expect(writeClawletsConfigMock).toHaveBeenCalledTimes(1);
      expect(updateDeployCredsEnvFileMock).toHaveBeenCalledTimes(1);
      expect(runMock).toHaveBeenCalledTimes(1);
      expect(captureMock).toHaveBeenCalledTimes(1);
      const secretsInitArgs = runMock.mock.calls.at(0)?.[1] as string[] | undefined;
      expect(Array.isArray(secretsInitArgs)).toBe(true);
      expect(secretsInitArgs).toContain("--allowMissingAdminPasswordHash");
      const secretsInitRunOpts = runMock.mock.calls.at(0)?.[2] as Record<string, unknown> | undefined;
      expect(secretsInitRunOpts?.stdout).toBe("ignore");
      const summaryRaw = String(logSpy.mock.calls.at(-1)?.[0] || "");
      const summary = JSON.parse(summaryRaw) as { config?: { updatedCount?: number } };
      expect(summary.config?.updatedCount).toBe(1);
    } finally {
      logSpy.mockRestore();
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("passes tailscale auth key to secrets init payload", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-keyring-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    let submittedSecretsBody: Record<string, unknown> | null = null;
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: { hosts: { alpha: {} }, fleet: {} },
        infraConfigPath: configPath,
      });
      updateDeployCredsEnvFileMock.mockResolvedValue({
        updatedKeys: ["SOPS_AGE_KEY_FILE"],
      });
      resolveActiveDeployCredsProjectTokenMock.mockReturnValue("tskey-from-keyring");
      runMock.mockImplementation(async (_cmd, args: string[]) => {
        const fromJsonIndex = args.indexOf("--from-json");
        if (fromJsonIndex < 0) return;
        const secretsPath = String(args[fromJsonIndex + 1] || "");
        submittedSecretsBody = JSON.parse(fs.readFileSync(secretsPath, "utf8")) as Record<string, unknown>;
        const ageKeyIndex = args.indexOf("--ageKeyFile");
        expect(ageKeyIndex).toBeGreaterThanOrEqual(0);
        expect(String(args[ageKeyIndex + 1] || "")).toBe("/tmp/runtime/keys/operators/alice.agekey");
      });
      captureMock.mockResolvedValue(
        JSON.stringify({
          results: [{ status: "ok" }],
        }),
      );

      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              SOPS_AGE_KEY_FILE: "/tmp/runtime/keys/operators/alice.agekey",
            },
            bootstrapSecrets: {
              adminPasswordHash: "$6$hash",
              tailscale_auth_key: "tskey-auth",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await apply.run({ args: { fromJson: inputPath, json: true } } as any);
      expect(submittedSecretsBody?.tailscaleAuthKey).toBe("tskey-auth");
      expect((submittedSecretsBody?.secrets as Record<string, unknown> | undefined)?.tailscale_auth_key).toBeUndefined();
      expect((submittedSecretsBody?.secrets as Record<string, unknown> | undefined)?.tailscaleAuthKey).toBeUndefined();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to active tailscale keyring value when bootstrap secrets omit tailscale key", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-setup-apply-keyring-fallback-"));
    const configPath = path.join(repoRoot, "clawlets.config.json");
    const inputPath = path.join(repoRoot, "setup-input.json");
    let submittedSecretsBody: Record<string, unknown> | null = null;
    try {
      findRepoRootMock.mockReturnValue(repoRoot);
      loadFullConfigMock.mockReturnValue({
        config: { hosts: { alpha: {} }, fleet: {} },
        infraConfigPath: configPath,
      });
      updateDeployCredsEnvFileMock.mockResolvedValue({
        updatedKeys: ["SOPS_AGE_KEY_FILE"],
      });
      resolveActiveDeployCredsProjectTokenMock.mockReturnValue("tskey-from-keyring");
      runMock.mockImplementation(async (_cmd, args: string[]) => {
        const fromJsonIndex = args.indexOf("--from-json");
        if (fromJsonIndex < 0) return;
        const secretsPath = String(args[fromJsonIndex + 1] || "");
        submittedSecretsBody = JSON.parse(fs.readFileSync(secretsPath, "utf8")) as Record<string, unknown>;
      });
      captureMock.mockResolvedValue(
        JSON.stringify({
          results: [{ status: "ok" }],
        }),
      );

      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          {
            hostName: "alpha",
            configOps: [
              { path: "hosts.alpha.provisioning.provider", value: "hetzner", del: false },
            ],
            deployCreds: {
              SOPS_AGE_KEY_FILE: "/tmp/runtime/keys/operators/alice.agekey",
            },
            bootstrapSecrets: {
              adminPasswordHash: "$6$hash",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const { setup } = await import("../src/commands/setup/index.js");
      const apply = (setup as any).subCommands?.apply;
      await apply.run({ args: { fromJson: inputPath, json: true } } as any);
      expect(submittedSecretsBody?.tailscaleAuthKey).toBe("tskey-from-keyring");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
