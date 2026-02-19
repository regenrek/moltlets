import { describe, expect, it, vi } from "vitest";
import {
  __test_appendRunEventsBestEffort,
  __test_computeIdleLeasePollDelayMs,
  __test_computePostJobIdlePollDelayMs,
  __test_defaultArgsForJob,
  __test_executeLeasedJobWithRunEvents,
  __test_metadataSnapshotFingerprint,
  __test_parseStructuredJsonObject,
  __test_parseSealedInputStringMap,
  __test_resolveRunnerRuntimeDir,
  __test_shouldSyncMetadata,
  __test_shouldStopOnCompletionError,
  __test_validateSealedInputKeysForJob,
  runnerStart,
} from "../src/commands/runner/start.js";

describe("runner job arg mapping", () => {
  it("exposes reduced default idle polling cap", () => {
    const args = (runnerStart as any).args as Record<string, { default?: string }>;
    expect(args.pollMs?.default).toBe("100");
    expect(args.pollMaxMs?.default).toBe("100");
    expect(args.leaseWaitMs?.default).toBe("0");
  });

  it("defaults runner runtime dir outside repo root", () => {
    const runtimeDir = __test_resolveRunnerRuntimeDir({
      projectId: "proj_1",
      runnerName: "setup-alpha",
      homeDir: "/Users/tester",
    });
    expect(runtimeDir).toBe("/Users/tester/.clawlets/runtime/runner/proj_1/setup-alpha");
  });

  it("sanitizes runtime dir path segments", () => {
    const runtimeDir = __test_resolveRunnerRuntimeDir({
      projectId: "proj / 1",
      runnerName: "setup alpha/beta",
      homeDir: "/Users/tester",
    });
    expect(runtimeDir).toBe("/Users/tester/.clawlets/runtime/runner/proj_1/setup_alpha_beta");
  });

  it("keeps explicit runtime dir when provided", () => {
    const runtimeDir = __test_resolveRunnerRuntimeDir({
      runtimeDirArg: "/tmp/my-runner-runtime",
      projectId: "proj_1",
      runnerName: "setup-alpha",
      homeDir: "/Users/tester",
    });
    expect(runtimeDir).toBe("/tmp/my-runner-runtime");
  });

  it("maps standard kinds to CLI args", () => {
    const args = __test_defaultArgsForJob({
      jobId: "job_1",
      runId: "run_1",
      leaseId: "lease_1",
      leaseExpiresAt: Date.now() + 30_000,
      kind: "secrets_verify",
      payloadMeta: { hostName: "alpha", scope: "bootstrap" },
      attempt: 1,
    });
    expect(args).toEqual(["secrets", "verify", "--host", "alpha", "--scope", "bootstrap"]);
  });

  it("requires explicit args for non-default server ops", () => {
    expect(() =>
      __test_defaultArgsForJob({
        jobId: "job_1",
        runId: "run_1",
        leaseId: "lease_1",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "server_status",
        attempt: 1,
      }),
    ).toThrow(/requires payloadMeta\.args/i);
  });

  it("stops only on auth/permanent completion errors", () => {
    expect(__test_shouldStopOnCompletionError("auth")).toBe(true);
    expect(__test_shouldStopOnCompletionError("permanent")).toBe(true);
    expect(__test_shouldStopOnCompletionError("transient")).toBe(false);
    expect(__test_shouldStopOnCompletionError("unknown")).toBe(false);
    expect(__test_shouldStopOnCompletionError("malformed")).toBe(false);
  });

  it("enforces UTF-8 byte limits for structured JSON", () => {
    expect(() => __test_parseStructuredJsonObject("{\"x\":\"é\"}", 9)).toThrow(/too large/i);
  });

  it("accepts structured JSON when UTF-8 bytes are within limit", () => {
    expect(__test_parseStructuredJsonObject("{\"ok\":true}", 11)).toBe("{\"ok\":true}");
  });

  it("logs and suppresses append run-events failures", async () => {
    const appendRunEvents = vi.fn(async () => {
      throw new Error("append outage");
    });
    await expect(
      __test_appendRunEventsBestEffort({
        client: { appendRunEvents },
        projectId: "proj_1",
        runId: "run_1",
        context: "command_start",
        events: [{ ts: 1, level: "info", message: "test" }],
      }),
    ).resolves.toBeUndefined();
    expect(appendRunEvents).toHaveBeenCalledTimes(1);
  });

  it("keeps terminal succeeded when append run-events fails on success path", async () => {
    const appendRunEvents = vi.fn(async () => {
      throw new Error("append outage");
    });
    const executeJobFn = vi.fn(async () => ({ output: "ok" }));
    const result = await __test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents },
      projectId: "proj_1",
      job: {
        jobId: "job_1",
        runId: "run_1",
        leaseId: "lease_1",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["doctor"] },
      },
      maxAttempts: 3,
      executeJobFn: executeJobFn as any,
    });
    expect(result).toMatchObject({ terminal: "succeeded" });
    expect(appendRunEvents).toHaveBeenCalledTimes(3);
  });

  it("rejects prototype-pollution keys in sealed JSON input", () => {
    expect(() => __test_parseSealedInputStringMap("{\"__proto__\":\"x\"}")).toThrow(/forbidden/i);
    expect(() => __test_parseSealedInputStringMap("{\"constructor\":\"x\"}")).toThrow(/forbidden/i);
    expect(() => __test_parseSealedInputStringMap("{\"prototype\":\"x\"}")).toThrow(/forbidden/i);
  });

  it("enforces deploy-creds allowlist for input placeholder jobs", () => {
    const job = {
      jobId: "job_1",
      runId: "run_1",
      leaseId: "lease_1",
      leaseExpiresAt: Date.now() + 30_000,
      kind: "custom",
      attempt: 1,
      payloadMeta: { updatedKeys: ["HCLOUD_TOKEN"], args: ["env", "apply-json"] },
    };
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { HCLOUD_TOKEN: "secret" },
        inputPlaceholder: true,
        secretsPlaceholder: false,
      }),
    ).not.toThrow();
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { GITHUB_TOKEN: "secret" },
        inputPlaceholder: true,
        secretsPlaceholder: false,
      }),
    ).toThrow(/not allowlisted/i);
  });

  it("requires payloadMeta.updatedKeys or payloadMeta.sealedInputKeys for input placeholder jobs", () => {
    const job = {
      jobId: "job_1",
      runId: "run_1",
      leaseId: "lease_1",
      leaseExpiresAt: Date.now() + 30_000,
      kind: "custom",
      attempt: 1,
      payloadMeta: { args: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__"] },
    };
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { HCLOUD_TOKEN: "secret" },
        inputPlaceholder: true,
        secretsPlaceholder: false,
      }),
    ).toThrow(/updatedKeys or payloadMeta\.sealedInputKeys required/i);
  });

  it("accepts token-keyring sealedInputKeys for env token-keyring-mutate jobs", () => {
    const job = {
      jobId: "job_1",
      runId: "run_1",
      leaseId: "lease_1",
      leaseExpiresAt: Date.now() + 30_000,
      kind: "custom",
      attempt: 1,
      payloadMeta: {
        args: ["env", "token-keyring-mutate", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
        sealedInputKeys: ["action", "kind", "value"],
      },
    };
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { action: "add", kind: "hcloud", value: "secret" },
        inputPlaceholder: true,
        secretsPlaceholder: false,
      }),
    ).not.toThrow();
  });

  it("rejects sealedInputKeys on non token-keyring input jobs", () => {
    const job = {
      jobId: "job_1",
      runId: "run_1",
      leaseId: "lease_1",
      leaseExpiresAt: Date.now() + 30_000,
      kind: "custom",
      attempt: 1,
      payloadMeta: {
        args: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
        sealedInputKeys: ["HCLOUD_TOKEN"],
      },
    };
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { HCLOUD_TOKEN: "secret" },
        inputPlaceholder: true,
        secretsPlaceholder: false,
      }),
    ).toThrow(/only supported for env token-keyring-mutate/i);
  });

  it("rejects unsupported sealedInputKeys for token-keyring jobs", () => {
    const job = {
      jobId: "job_1",
      runId: "run_1",
      leaseId: "lease_1",
      leaseExpiresAt: Date.now() + 30_000,
      kind: "custom",
      attempt: 1,
      payloadMeta: {
        args: ["env", "token-keyring-mutate", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
        sealedInputKeys: ["action", "badKey"],
      },
    };
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { action: "add", badKey: "x" },
        inputPlaceholder: true,
        secretsPlaceholder: false,
      }),
    ).toThrow(/invalid entry/i);
  });

  it("enforces secretNames allowlist for secrets placeholder jobs", () => {
    const job = {
      jobId: "job_1",
      runId: "run_1",
      leaseId: "lease_1",
      leaseExpiresAt: Date.now() + 30_000,
      kind: "secrets_init",
      attempt: 1,
      payloadMeta: { secretNames: ["DISCORD_TOKEN"], args: ["secrets", "init"] },
    };
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { DISCORD_TOKEN: "secret" },
        inputPlaceholder: false,
        secretsPlaceholder: true,
      }),
    ).not.toThrow();
    expect(() =>
      __test_validateSealedInputKeysForJob({
        job: job as any,
        values: { DISCORD_TOKEN: "secret", EXTRA: "oops" },
        inputPlaceholder: false,
        secretsPlaceholder: true,
      }),
    ).toThrow(/not allowlisted/i);
  });

  it("sanitizes non-structured command output before appending run-events", async () => {
    const appendRunEvents = vi.fn(async () => {});
    const executeJobFn = vi.fn(async () => ({
      output: "Authorization: Bearer supersecret apiKey = abc123",
    }));
    const result = await __test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents },
      projectId: "proj_1",
      job: {
        jobId: "job_1",
        runId: "run_1",
        leaseId: "lease_1",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["doctor"] },
      },
      maxAttempts: 3,
      executeJobFn: executeJobFn as any,
    });
    expect(result).toMatchObject({ terminal: "succeeded" });
    const outputEvent = appendRunEvents.mock.calls
      .flatMap((call) => (call?.[0]?.events || []) as Array<{ message?: string; redacted?: boolean }>)
      .find((event) => typeof event?.message === "string" && event.message.includes("Authorization: Bearer"));
    expect(outputEvent).toBeTruthy();
    expect(outputEvent?.message).toContain("Authorization: Bearer <redacted>");
    expect(outputEvent?.message).toContain("apiKey = <redacted>");
    expect(outputEvent?.redacted).toBe(true);
  });

  it("backs off idle polling with jitter and clamps to bounds", () => {
    const low = __test_computeIdleLeasePollDelayMs({
      pollMs: 4_000,
      pollMaxMs: 30_000,
      emptyLeaseStreak: 0,
      random: () => 0,
    });
    const high = __test_computeIdleLeasePollDelayMs({
      pollMs: 4_000,
      pollMaxMs: 30_000,
      emptyLeaseStreak: 6,
      random: () => 1,
    });
    expect(low).toBeGreaterThanOrEqual(4_000);
    expect(low).toBeLessThanOrEqual(30_000);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(30_000);
  });

  it("uses 0ms post-job delay when backlog path is active and 100ms after idle long-poll wakeup", () => {
    expect(
      __test_computePostJobIdlePollDelayMs({
        requestedWaitMs: 0,
        waitApplied: false,
        pollMs: 100,
      }),
    ).toBe(0);
    expect(
      __test_computePostJobIdlePollDelayMs({
        requestedWaitMs: 5_000,
        waitApplied: true,
        pollMs: 100,
      }),
    ).toBe(100);
  });

  it("metadata fingerprint ignores ephemeral run/sync timestamps", () => {
    const basePayload = {
      projectConfigs: [{ type: "fleet", path: "fleet/clawlets.json", sha256: "abc" }],
      hosts: [
        {
          hostName: "alpha",
          patch: {
            lastSeenAt: 111,
            lastStatus: "online",
            lastRunId: "run_1",
            lastRunStatus: "succeeded",
            desired: { enabled: true, provider: "hetzner" },
          },
        },
      ],
      gateways: [
        {
          hostName: "alpha",
          gatewayId: "gw1",
          patch: {
            lastSeenAt: 111,
            lastStatus: "unknown",
            desired: { enabled: true, channels: ["discord"] },
          },
        },
      ],
      secretWiring: [
        {
          hostName: "alpha",
          secretName: "DISCORD_TOKEN",
          scope: "openclaw",
          status: "configured",
          required: true,
          lastVerifiedAt: 111,
        },
      ],
    } as const;
    const changedEphemeral = {
      ...basePayload,
      hosts: [
        {
          ...basePayload.hosts[0],
          patch: {
            ...basePayload.hosts[0].patch,
            lastSeenAt: 999,
            lastRunId: "run_2",
            lastRunStatus: "failed",
          },
        },
      ],
      gateways: [
        {
          ...basePayload.gateways[0],
          patch: { ...basePayload.gateways[0].patch, lastSeenAt: 999 },
        },
      ],
      secretWiring: [{ ...basePayload.secretWiring[0], lastVerifiedAt: 999 }],
    };
    expect(__test_metadataSnapshotFingerprint(basePayload as any)).toBe(
      __test_metadataSnapshotFingerprint(changedEphemeral as any),
    );
  });

  it("metadata sync decision triggers on first sync, diff, and staleness", () => {
    expect(
      __test_shouldSyncMetadata({
        fingerprint: "a",
        now: 1_000,
        lastFingerprint: null,
        lastSyncedAt: null,
        maxAgeMs: 60_000,
      }),
    ).toBe(true);
    expect(
      __test_shouldSyncMetadata({
        fingerprint: "b",
        now: 2_000,
        lastFingerprint: "a",
        lastSyncedAt: 1_000,
        maxAgeMs: 60_000,
      }),
    ).toBe(true);
    expect(
      __test_shouldSyncMetadata({
        fingerprint: "a",
        now: 30_000,
        lastFingerprint: "a",
        lastSyncedAt: 1_000,
        maxAgeMs: 60_000,
      }),
    ).toBe(false);
    expect(
      __test_shouldSyncMetadata({
        fingerprint: "a",
        now: 70_001,
        lastFingerprint: "a",
        lastSyncedAt: 1_000,
        maxAgeMs: 60_000,
      }),
    ).toBe(true);
  });

  it("returns commandResultJson and appends redacted output marker", async () => {
    const appendRunEvents = vi.fn(async () => {});
    const executeJobFn = vi.fn(async () => ({
      redactedOutput: true,
      commandResultJson: "{\"ok\":true}",
    }));
    const result = await __test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents },
      projectId: "proj_1",
      job: {
        jobId: "job_1",
        runId: "run_1",
        leaseId: "lease_1",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["config", "show", "--pretty=false"] },
      },
      maxAttempts: 3,
      executeJobFn: executeJobFn as any,
    });
    expect(result).toMatchObject({ terminal: "succeeded", commandResultJson: "{\"ok\":true}" });
    const outputEvent = appendRunEvents.mock.calls.find((call) => {
      const events = call?.[0]?.events as Array<{ redacted?: boolean; message?: string }> | undefined;
      return Array.isArray(events) && events.some((event) => event.redacted === true);
    });
    expect(outputEvent).toBeTruthy();
  });

  it("returns commandResultLargeJson and appends redacted output marker", async () => {
    const appendRunEvents = vi.fn(async () => {});
    const executeJobFn = vi.fn(async () => ({
      redactedOutput: true,
      commandResultLargeJson: "{\"ok\":true,\"payload\":{\"a\":1}}",
    }));
    const result = await __test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents },
      projectId: "proj_1",
      job: {
        jobId: "job_1",
        runId: "run_1",
        leaseId: "lease_1",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 1,
        payloadMeta: { args: ["openclaw", "schema", "fetch", "--host", "alpha", "--gateway", "gw1", "--ssh-tty=false"] },
      },
      maxAttempts: 3,
      executeJobFn: executeJobFn as any,
    });
    expect(result).toMatchObject({ terminal: "succeeded", commandResultLargeJson: "{\"ok\":true,\"payload\":{\"a\":1}}" });
    const outputEvent = appendRunEvents.mock.calls.find((call) => {
      const events = call?.[0]?.events as Array<{ redacted?: boolean; message?: string }> | undefined;
      return Array.isArray(events) && events.some((event) => event.redacted === true);
    });
    expect(outputEvent).toBeTruthy();
  });

  it("fails leased jobs when attempt count exceeds maxAttempts", async () => {
    const appendRunEvents = vi.fn(async () => ({}));
    const executeJobFn = vi.fn(async () => ({ output: "ok" }));
    const result = await __test_executeLeasedJobWithRunEvents({
      client: { appendRunEvents },
      projectId: "proj_1",
      job: {
        jobId: "job_retry",
        runId: "run_retry",
        leaseId: "lease_retry",
        leaseExpiresAt: Date.now() + 30_000,
        kind: "custom",
        attempt: 5,
        payloadMeta: { args: ["doctor"] },
      },
      maxAttempts: 3,
      executeJobFn: executeJobFn as any,
    });
    expect(result.terminal).toBe("failed");
    expect(result.errorMessage).toBeTruthy();
    expect(executeJobFn).not.toHaveBeenCalled();
  });
});
