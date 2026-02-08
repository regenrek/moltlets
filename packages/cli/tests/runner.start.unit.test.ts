import { describe, expect, it, vi } from "vitest";
import {
  __test_appendRunEventsBestEffort,
  __test_defaultArgsForJob,
  __test_executeLeasedJobWithRunEvents,
  __test_shouldStopOnCompletionError,
} from "../src/commands/runner/start.js";

describe("runner job arg mapping", () => {
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

  it("logs and suppresses append run-events failures", async () => {
    const appendRunEvents = vi.fn(async () => {
      throw new Error("append outage");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
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
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("runner run-events append failed (command_start): append outage"));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps terminal succeeded when append run-events fails on success path", async () => {
    const appendRunEvents = vi.fn(async () => {
      throw new Error("append outage");
    });
    const executeJobFn = vi.fn(async () => ({ output: "ok" }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
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
      expect(result).toEqual({ terminal: "succeeded" });
      expect(appendRunEvents).toHaveBeenCalledTimes(3);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("runner run-events append failed (command_end): append outage"));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
