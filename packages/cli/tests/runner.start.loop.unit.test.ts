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
  appendRunEvents: ReturnType<typeof vi.fn>;
  syncMetadata: ReturnType<typeof vi.fn>;
  runCommand: ReturnType<typeof vi.fn>;
  errorSpy: ReturnType<typeof vi.spyOn>;
  logSpy: ReturnType<typeof vi.spyOn>;
  makeHttpError: (kind: MockRunnerHttpErrorKind, message: string) => Error;
};

async function loadRunnerStartLoopHarness(params?: {
  leaseQueue?: Array<MockJob | null | Error>;
  completeResultOk?: boolean;
  completeError?: Error;
  syncMetadataError?: Error;
}): Promise<RunnerStartLoopHarness> {
  vi.resetModules();

  const runCommand = vi.fn(async () => {});
  const capture = vi.fn(async () => "");
  vi.doMock("@clawlets/core/lib/runtime/run", () => ({ run: runCommand, capture }));
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

  class MockRunnerApiClient {
    heartbeat = heartbeat;
    leaseNext = leaseNext;
    heartbeatJob = heartbeatJob;
    completeJob = completeJob;
    appendRunEvents = appendRunEvents;
    syncMetadata = syncMetadata;

    constructor(_baseUrl: string, _token: string) {}
  }

  vi.doMock("../src/commands/runner/client.js", () => ({
    RunnerApiClient: MockRunnerApiClient,
    RunnerHttpError: MockRunnerHttpError,
    classifyRunnerHttpError: (error: unknown) =>
      error instanceof MockRunnerHttpError ? error.kind : "unknown",
  }));

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const mod = await import("../src/commands/runner/start.js");
  const runStart = async (args: Record<string, unknown>) => {
    await mod.runnerStart.run({ args } as any);
  };
  return {
    runStart,
    heartbeat,
    leaseNext,
    completeJob,
    appendRunEvents,
    syncMetadata,
    runCommand,
    errorSpy,
    logSpy,
    makeHttpError,
  };
}

describe("runner start loop", () => {
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

    try {
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
      expect(harness.errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Authorization: Bearer <redacted>"),
      );
      expect(harness.errorSpy).toHaveBeenCalledWith(expect.stringContaining("https://<redacted>@example.com?token=<redacted>"));
    } finally {
      harness.errorSpy.mockRestore();
      harness.logSpy.mockRestore();
    }
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
    try {
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
    } finally {
      harness.errorSpy.mockRestore();
      harness.logSpy.mockRestore();
    }
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
    try {
      await harness.runStart({
        project: "p1",
        token: "runner-token",
        controlPlaneUrl: "https://cp.example.com",
      });
      expect(harness.errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("runner completion failed (auth); stopping: Authorization: Basic <redacted>"),
      );
      expect(harness.syncMetadata).toHaveBeenCalled();
    } finally {
      harness.errorSpy.mockRestore();
      harness.logSpy.mockRestore();
    }
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
    try {
      await harness.runStart({
        project: "p1",
        token: "runner-token",
        controlPlaneUrl: "https://cp.example.com",
        once: true,
      });
      expect(harness.errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("runner completion failed (transient); continuing: https://<redacted>@example.com?api_key=<redacted>"),
      );
    } finally {
      harness.errorSpy.mockRestore();
      harness.logSpy.mockRestore();
    }
  });
});
