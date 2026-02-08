import { describe, expect, it, vi } from "vitest";
import { enqueueRunnerCommand } from "~/sdk/runtime/runner-jobs";

describe("runner jobs queue helper", () => {
  it("queues run+job atomically via jobs.enqueue", async () => {
    const mutation = vi.fn(async (_mutation: unknown, payload: any) => ({
      runId: payload.runId || "run_1",
      jobId: "job_1",
    }));
    const client = { mutation } as any;
    const queued = await enqueueRunnerCommand({
      client,
      projectId: "p1" as any,
      runKind: "custom",
      title: "Test command",
      host: "alpha",
      args: ["echo", "ok"],
      note: "unit test",
    });

    expect(queued).toEqual({ runId: "run_1", jobId: "job_1" });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      projectId: "p1",
      kind: "custom",
      title: "Test command",
      host: "alpha",
      payloadMeta: {
        hostName: "alpha",
        args: ["echo", "ok"],
        note: "unit test",
      },
    });
  });
});
