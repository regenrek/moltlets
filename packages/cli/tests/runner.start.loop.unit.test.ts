import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { RUNNER_SEALED_INPUT_ALG } from "../src/commands/runner/sealed-input.js";

type MockJob = {
  jobId: string;
  runId: string;
  leaseId: string;
  leaseExpiresAt: number;
  kind: string;
  attempt: number;
  payloadMeta?: { args?: string[] };
};

type MockRunnerHttpErrorKind = "auth" | "permanent" | "transient" | "malformed";

type RunnerStartLoopHarness = {
  runStart: (args: Record<string, unknown>) => Promise<void>;
  heartbeat: ReturnType<typeof vi.fn>;
  leaseNext: ReturnType<typeof vi.fn>;
  completeJob: ReturnType<typeof vi.fn>;
  heartbeatJob: ReturnType<typeof vi.fn>;
  appendRunEvents: ReturnType<typeof vi.fn>;
  syncMetadata: ReturnType<typeof vi.fn>;
  execCaptureTail: ReturnType<typeof vi.fn>;
  execCaptureStdout: ReturnType<typeof vi.fn>;
  logger: {
    child: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  makeHttpError: (kind: MockRunnerHttpErrorKind, message: string) => Error;
  getClientInit: () => { baseUrl: string; token: string };
};

async function loadRunnerStartLoopHarness(params?: {
  leaseQueue?: Array<MockJob | null | Error>;
  completeResultOk?: boolean;
  completeError?: Error;
  syncMetadataError?: Error;
}): Promise<RunnerStartLoopHarness> {
  vi.resetModules();

  const execCaptureTail = vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    durationMs: 1,
    stdoutTail: "",
    stderrTail: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  }));
  const execCaptureStdout = vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    durationMs: 1,
    stdout: "",
    stderrTail: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  }));
  vi.doMock("../src/commands/runner/exec.js", () => ({ execCaptureTail, execCaptureStdout }));
  vi.doMock("@clawlets/core/lib/nix/nix-bin", () => ({ resolveNixBin: () => null }));
  vi.doMock("@clawlets/core/lib/project/repo", () => ({ findRepoRoot: () => "/repo" }));
  vi.doMock("@clawlets/core/lib/runtime/runner-command-policy-resolve", () => ({
    resolveRunnerJobCommand: vi.fn(async () => ({
      ok: true,
      kind: "custom",
      exec: "clawlets",
      args: ["doctor"],
      resultMode: "log",
    })),
  }));

  const buildMetadataSnapshot = vi.fn(async () => ({
    projectConfigs: [],
    hosts: [],
    gateways: [],
    secretWiring: [],
  }));
  vi.doMock("../src/commands/runner/metadata.js", () => ({ buildMetadataSnapshot }));

  vi.doMock("../src/commands/runner/sealed-input.js", () => ({
    resolveRunnerSealedInputKeyPath: vi.fn(async () => "/tmp/runner-sealed-input.pem"),
    loadOrCreateRunnerSealedInputKeypair: vi.fn(async () => ({
      privateKeyPem: "pem",
      publicKeySpkiB64: "AQID",
      keyId: "kid-1",
      alg: RUNNER_SEALED_INPUT_ALG,
    })),
    unsealRunnerInput: vi.fn(() => "{}"),
    RUNNER_SEALED_INPUT_ALG,
  }));

  class MockRunnerHttpError extends Error {
    kind: MockRunnerHttpErrorKind;
    path: string;
    status?: number;

    constructor(args: { kind: MockRunnerHttpErrorKind; path: string; message: string; status?: number }) {
      super(args.message);
      this.name = "RunnerHttpError";
      this.kind = args.kind;
      this.path = args.path;
      this.status = args.status;
    }
  }

  const makeHttpError = (kind: MockRunnerHttpErrorKind, message: string): Error =>
    new MockRunnerHttpError({ kind, path: "/runner/mock", message });

  const queue = [...(params?.leaseQueue ?? [])];
  const heartbeat = vi.fn(async () => ({ ok: true, runnerId: "runner-1" }));
  const leaseNext = vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { job: (next ?? null) as any };
  });
  const heartbeatJob = vi.fn(async () => ({ ok: true, status: "running" }));
  const completeJob = vi.fn(async () => {
    if (params?.completeError) throw params.completeError;
    return { ok: params?.completeResultOk ?? true };
  });
  const appendRunEvents = vi.fn(async () => ({ ok: true }));
  const syncMetadata = vi.fn(async () => {
    if (params?.syncMetadataError) throw params.syncMetadataError;
    return { ok: true };
  });
  let clientBaseUrl = "";
  let clientToken = "";

  class MockRunnerApiClient {
    heartbeat = heartbeat;
    leaseNext = leaseNext;
    heartbeatJob = heartbeatJob;
    completeJob = completeJob;
    appendRunEvents = appendRunEvents;
    syncMetadata = syncMetadata;

    constructor(baseUrl: string, token: string) {
      clientBaseUrl = baseUrl;
      clientToken = token;
    }
  }

  vi.doMock("../src/commands/runner/client.js", () => ({
    RunnerApiClient: MockRunnerApiClient,
    RunnerHttpError: MockRunnerHttpError,
    classifyRunnerHttpError: (error: unknown) =>
      error instanceof MockRunnerHttpError ? error.kind : "unknown",
  }));

  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  logger.child.mockImplementation(() => logger);
  vi.doMock("../src/lib/logging/logger.js", async () => {
    const actual = await vi.importActual<typeof import("../src/lib/logging/logger.js")>(
      "../src/lib/logging/logger.js",
    );
    return {
      ...actual,
      createRunnerLogger: vi.fn(() => logger),
      parseLogLevel: vi.fn((_raw: unknown, fallback: string) => fallback),
      resolveRunnerLogFile: vi.fn(() => "/tmp/clawlets-runner.jsonl"),
    };
  });

  const mod = await import("../src/commands/runner/start.js");
  const runStart = async (args: Record<string, unknown>) => {
    await mod.runnerStart.run({ args } as any);
  };
  return {
    runStart,
    heartbeat,
    leaseNext,
    heartbeatJob,
    completeJob,
    appendRunEvents,
    syncMetadata,
    execCaptureTail,
    execCaptureStdout,
    logger,
    makeHttpError,
    getClientInit: () => ({ baseUrl: clientBaseUrl, token: clientToken }),
  };
}

  describe("runner start loop", () => {
    it("requires project and token", async () => {
      const harness = await loadRunnerStartLoopHarness();
      await expect(
        harness.runStart({
          token: "runner-token",
          controlPlaneUrl: "https://cp.example.com",
          once: true,
        }),
      ).rejects.toThrow(/missing --project/i);

      await expect(
        harness.runStart({
          project: "p1",
          controlPlaneUrl: "https://cp.example.com",
          once: true,
        }),
      ).rejects.toThrow(/missing --token/i);
    });

    it("starts leasing immediately even when startup metadata sync is slow", async () => {
      const harness = await loadRunnerStartLoopHarness({
        leaseQueue: [null],
      });
      harness.syncMetadata.mockImplementation(() => new Promise(() => {}));
      await harness.runStart({
        project: "p1",
        token: "runner-token",
        controlPlaneUrl: "https://cp.example.com",
        once: true,
      });
      expect(harness.heartbeat).toHaveBeenCalledWith(
        expect.objectContaining({ status: "online", projectId: "p1" }),
      );
      expect(harness.leaseNext).toHaveBeenCalledTimes(1);
      expect(harness.leaseNext).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "p1",
          waitMs: 0,
          waitPollMs: 100,
        }),
      );
    });

    it("performs bounded metadata flush on shutdown when sync is in flight", async () => {
      const harness = await loadRunnerStartLoopHarness({
        leaseQueue: [null],
      });
      harness.syncMetadata.mockImplementation(() => new Promise(() => {}));
      const startedAt = Date.now();
      await harness.runStart({
        project: "p1",
        token: "runner-token",
        controlPlaneUrl: "https://cp.example.com",
        once: true,
      });
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(1_500);
      expect(elapsedMs).toBeLessThan(8_000);
      expect(harness.heartbeat).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "offline", projectId: "p1" }),
      );
    });

  it("reads control-plane url from environment and normalizes trailing slashes", async () => {
    const prevControlPlane = process.env.CLAWLETS_CONTROL_PLANE_URL;
    const prevConvexSite = process.env.CONVEX_SITE_URL;
    process.env.CLAWLETS_CONTROL_PLANE_URL = " https://cp.example.com/// ";
    delete process.env.CONVEX_SITE_URL;

    const harness = await loadRunnerStartLoopHarness({
      leaseQueue: [null],
    });
    try {
      await harness.runStart({
        project: "p1",
        token: "runner-token",
        once: true,
      });
      expect(harness.getClientInit()).toEqual({
        baseUrl: "https://cp.example.com",
        token: "runner-token",
      });
	    } finally {
	      if (prevControlPlane === undefined) delete process.env.CLAWLETS_CONTROL_PLANE_URL;
	      else process.env.CLAWLETS_CONTROL_PLANE_URL = prevControlPlane;
	      if (prevConvexSite === undefined) delete process.env.CONVEX_SITE_URL;
	      else process.env.CONVEX_SITE_URL = prevConvexSite;
	    }
	  });

  it("fails fast when control-plane url is missing from args and env", async () => {
    const prevControlPlane = process.env.CLAWLETS_CONTROL_PLANE_URL;
    const prevConvexSite = process.env.CONVEX_SITE_URL;
    delete process.env.CLAWLETS_CONTROL_PLANE_URL;
    delete process.env.CONVEX_SITE_URL;

    const harness = await loadRunnerStartLoopHarness();
    try {
      await expect(
        harness.runStart({
          project: "p1",
          token: "runner-token",
          once: true,
        }),
      ).rejects.toThrow(/missing control-plane url/i);
	    } finally {
	      if (prevControlPlane === undefined) delete process.env.CLAWLETS_CONTROL_PLANE_URL;
	      else process.env.CLAWLETS_CONTROL_PLANE_URL = prevControlPlane;
	      if (prevConvexSite === undefined) delete process.env.CONVEX_SITE_URL;
	      else process.env.CONVEX_SITE_URL = prevConvexSite;
	    }
	  });
	it("stops on auth lease errors and redacts secret-like error content", async () => {
	  const harness = await loadRunnerStartLoopHarness({
	    leaseQueue: [new Error("placeholder")],
	  });
    const authError = harness.makeHttpError(
      "auth",
      "Authorization: Bearer secret123 https://user:pw@example.com?token=abc",
    );
	  harness.leaseNext.mockReset();
	  harness.leaseNext.mockRejectedValue(authError);

	  await harness.runStart({
	    project: "p1",
	    token: "runner-token",
	    controlPlaneUrl: "https://cp.example.com",
	  });
	  expect(harness.heartbeat).toHaveBeenCalledWith(
	    expect.objectContaining({ status: "online", projectId: "p1" }),
	  );
	  expect(harness.heartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ status: "offline" }));
	  expect(harness.completeJob).not.toHaveBeenCalled();
	  expect(harness.leaseNext).toHaveBeenCalledWith(
	    expect.objectContaining({
	      projectId: "p1",
	      waitMs: 0,
	      waitPollMs: 100,
        }),
      );
	  expect(harness.logger.error).toHaveBeenCalledWith(
	    expect.objectContaining({
	      kind: "auth",
	      error: expect.stringContaining("Authorization: Bearer <redacted>"),
	    }),
	    expect.stringContaining("runner lease failed"),
	  );
	  expect(harness.logger.error).toHaveBeenCalledWith(
	    expect.objectContaining({
	      kind: "auth",
	      error: expect.stringContaining("https://<redacted>@example.com?token=<redacted>"),
	    }),
	    expect.stringContaining("runner lease failed"),
	  );
	});

	  it("processes one leased job, appends run-events, completes, and syncs metadata", async () => {
	    const harness = await loadRunnerStartLoopHarness({
	      leaseQueue: [
	        {
          jobId: "job-1",
          runId: "run-1",
          leaseId: "lease-1",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["doctor"] },
	        },
	      ],
	    });
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      once: true,
	    });
	    expect(harness.appendRunEvents).toHaveBeenCalled();
	    expect(harness.completeJob).toHaveBeenCalledWith(
	      expect.objectContaining({
	        projectId: "p1",
	        jobId: "job-1",
	        leaseId: "lease-1",
	        status: "succeeded",
	      }),
	    );
	    expect(harness.syncMetadata).toHaveBeenCalledWith(
	      expect.objectContaining({
	        projectId: "p1",
	        payload: expect.objectContaining({
	          projectConfigs: [],
	          hosts: [],
	          gateways: [],
	          secretWiring: [],
	        }),
	      }),
	    );
	    expect(harness.syncMetadata).toHaveBeenCalledTimes(1);
	  });

	  it("stops after auth completion failure and logs sanitized message", async () => {
	    const harness = await loadRunnerStartLoopHarness({
      leaseQueue: [
        {
          jobId: "job-2",
          runId: "run-2",
          leaseId: "lease-2",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["doctor"] },
        },
      ],
      completeError: new Error("placeholder"),
    });
	    harness.completeJob.mockReset();
	    harness.completeJob.mockRejectedValue(
	      harness.makeHttpError("auth", "Authorization: Basic dXNlcjpzZWNyZXQ="),
	    );
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	    });
	    expect(harness.logger.error).toHaveBeenCalledWith(
	      expect.objectContaining({
	        jobId: "job-2",
	        kind: "auth",
	        error: expect.stringContaining("Authorization: Basic <redacted>"),
	      }),
	      expect.stringContaining("runner completion failed"),
	    );
	    expect(harness.syncMetadata).toHaveBeenCalled();
	  });

	  it("logs non-fatal completion failure for transient errors", async () => {
    const harness = await loadRunnerStartLoopHarness({
      leaseQueue: [
        {
          jobId: "job-3",
          runId: "run-3",
          leaseId: "lease-3",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["doctor"] },
        },
      ],
    });
	    harness.completeJob.mockReset();
	    harness.completeJob.mockRejectedValue(
	      harness.makeHttpError("transient", "https://user:pw@example.com?api_key=abc"),
	    );
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      once: true,
	    });
	    expect(harness.logger.warn).toHaveBeenCalledWith(
	      expect.objectContaining({
	        jobId: "job-3",
	        kind: "transient",
	        error: expect.stringContaining("https://<redacted>@example.com?api_key=<redacted>"),
	      }),
	      expect.stringContaining("runner completion failed"),
	    );
	  });

	  it("logs when control plane rejects completion due lease/status mismatch", async () => {
    const harness = await loadRunnerStartLoopHarness({
      leaseQueue: [
        {
          jobId: "job-4",
          runId: "run-4",
          leaseId: "lease-4",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["doctor"] },
        },
      ],
      completeResultOk: false,
	    });
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      once: true,
	    });
	    expect(harness.logger.error).toHaveBeenCalledWith(
	      expect.objectContaining({ jobId: "job-4" }),
	      expect.stringContaining("runner completion rejected"),
	    );
	  });

	  it("logs startup metadata sync failures and continues boot", async () => {
	    const harness = await loadRunnerStartLoopHarness({
	      leaseQueue: [null],
	      syncMetadataError: new Error("startup sync failed"),
	    });
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      once: true,
	    });
	    expect(harness.logger.warn).toHaveBeenCalledWith(
	      expect.objectContaining({ context: "startup", error: expect.stringContaining("startup sync failed") }),
	      expect.stringContaining("metadata sync failed"),
	    );
	  });

	  it("logs job metadata sync failures with job id context", async () => {
	    const harness = await loadRunnerStartLoopHarness({
      leaseQueue: [
        {
          jobId: "job-5",
          runId: "run-5",
          leaseId: "lease-5",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["doctor"] },
        },
      ],
	      syncMetadataError: new Error("job sync failed"),
	    });
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      once: true,
	    });
	    expect(harness.logger.warn).toHaveBeenCalledWith(
	      expect.objectContaining({ jobId: "job-5", error: expect.stringContaining("job sync failed") }),
	      expect.stringContaining("metadata sync failed"),
	    );
	  });

	  it("continues after empty lease when once=false, then stops on auth lease error", async () => {
    const harness = await loadRunnerStartLoopHarness();
    const stopError = harness.makeHttpError("auth", "lease auth failure");
	    harness.leaseNext.mockReset();
	    harness.leaseNext
	      .mockResolvedValueOnce({ job: null })
	      .mockRejectedValueOnce(stopError);
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      pollMs: "250",
	      pollMaxMs: "1000",
	    });
	    expect(harness.leaseNext).toHaveBeenCalledTimes(2);
	    expect(harness.logger.error).toHaveBeenCalledWith(
	      expect.objectContaining({ kind: "auth", error: expect.stringContaining("lease auth failure") }),
	      expect.stringContaining("runner lease failed"),
	    );
	  });

	  it("retries transient lease errors with backoff and then continues", async () => {
    const harness = await loadRunnerStartLoopHarness();
    const transientError = harness.makeHttpError("transient", "temporary lease failure");
	    harness.leaseNext.mockReset();
	    harness.leaseNext
	      .mockRejectedValueOnce(transientError)
	      .mockResolvedValueOnce({ job: null });
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      once: true,
	      pollMs: "250",
	      pollMaxMs: "1000",
	    });
	    expect(harness.leaseNext).toHaveBeenCalledTimes(2);
	    expect(harness.logger.warn).toHaveBeenCalledWith(
	      expect.objectContaining({ kind: "transient", error: expect.stringContaining("temporary lease failure"), backoffMs: expect.any(Number) }),
	      expect.stringContaining("runner lease failed"),
	    );
	  });

	  it("logs runner heartbeat failures without crashing the loop", async () => {
	    const harness = await loadRunnerStartLoopHarness({
	      leaseQueue: [null],
	    });
	    harness.heartbeat.mockRejectedValue(new Error("heartbeat failed"));
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      once: true,
	    });
	    expect(harness.logger.error).toHaveBeenCalledWith(
	      expect.objectContaining({ error: expect.stringContaining("heartbeat failed") }),
	      expect.stringContaining("runner heartbeat error"),
	    );
	  });

	  it("logs temp-file cleanup failures and continues startup", async () => {
	    const harness = await loadRunnerStartLoopHarness({
	      leaseQueue: [null],
	    });
	    const tmpdirSpy = vi.spyOn(os, "tmpdir").mockImplementation(() => {
	      throw new Error("tmpdir unavailable");
	    });
	    try {
	      await harness.runStart({
	        project: "p1",
	        token: "runner-token",
	        controlPlaneUrl: "https://cp.example.com",
	        once: true,
	      });
	      expect(harness.logger.warn).toHaveBeenCalledWith(
	        expect.objectContaining({ error: expect.stringContaining("tmpdir unavailable") }),
	        expect.stringContaining("runner temp-file cleanup failed"),
	      );
	    } finally {
	      tmpdirSpy.mockRestore();
	    }
	  });

	  it("stops loop on SIGTERM by flipping running flag", async () => {
    const harness = await loadRunnerStartLoopHarness({
      leaseQueue: [null, null, null, null],
    });
	    const signalTimer = setTimeout(() => {
	      process.emit("SIGTERM");
	    }, 80);
	    try {
	      await harness.runStart({
	        project: "p1",
	        token: "runner-token",
	        controlPlaneUrl: "https://cp.example.com",
	        pollMs: "250",
	        pollMaxMs: "500",
	      });
	      expect(harness.heartbeat).toHaveBeenLastCalledWith(
	        expect.objectContaining({ status: "offline" }),
	      );
	    } finally {
	      clearTimeout(signalTimer);
	    }
	  });

	  it("logs heartbeat failures while leased job is still running", async () => {
    const harness = await loadRunnerStartLoopHarness({
      leaseQueue: [
        {
          jobId: "job-6",
          runId: "run-6",
          leaseId: "lease-6",
          leaseExpiresAt: Date.now() + 30_000,
          kind: "custom",
          attempt: 1,
          payloadMeta: { args: ["doctor"] },
        },
      ],
	    });
	    harness.heartbeatJob.mockRejectedValue(new Error("heartbeat down"));
	    harness.execCaptureStdout.mockImplementation(async () => {
	      await new Promise((resolve) => setTimeout(resolve, 2600));
	      return {
	        exitCode: 0,
	        signal: null,
	        durationMs: 2600,
	        stdout: "",
	        stderrTail: "",
	        stdoutTruncated: false,
	        stderrTruncated: false,
	      };
	    });
	    await harness.runStart({
	      project: "p1",
	      token: "runner-token",
	      controlPlaneUrl: "https://cp.example.com",
	      leaseTtlMs: "5000",
	      heartbeatMs: "2000",
	      once: true,
	    });
	    expect(harness.logger.warn).toHaveBeenCalledWith(
	      expect.objectContaining({ jobId: "job-6", error: expect.stringContaining("heartbeat down") }),
	      expect.stringContaining("runner job heartbeat failed"),
	    );
	  }, 15_000);
});
