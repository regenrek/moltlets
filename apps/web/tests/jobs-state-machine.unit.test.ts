import { describe, expect, it } from "vitest";
import {
  canCompleteJob,
  cancelJobPatch,
  cancelRunPatch,
  isTerminalJobStatus,
} from "../convex/controlPlane/jobState";

describe("job completion guard", () => {
  it("rejects lease mismatch", () => {
    const res = canCompleteJob({
      job: { status: "running", leaseId: "lease-a", leaseExpiresAt: 200 },
      leaseId: "lease-b",
      now: 100,
    });
    expect(res).toEqual({ ok: false, status: "running" });
  });

  it("rejects canceled and queued jobs", () => {
    expect(
      canCompleteJob({
        job: { status: "canceled", leaseId: "lease-a", leaseExpiresAt: 200 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "canceled" });
    expect(
      canCompleteJob({
        job: { status: "queued", leaseId: "lease-a", leaseExpiresAt: 200 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "queued" });
  });

  it("rejects expired leases and accepts valid running lease", () => {
    expect(
      canCompleteJob({
        job: { status: "running", leaseId: "lease-a", leaseExpiresAt: 100 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "running" });
    expect(
      canCompleteJob({
        job: { status: "running", leaseId: "lease-a", leaseExpiresAt: 200 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: true, status: "running" });
  });

  it("rejects missing lease expiry", () => {
    expect(
      canCompleteJob({
        job: { status: "running", leaseId: "lease-a" },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "running" });
  });

  it("classifies terminal job statuses", () => {
    expect(isTerminalJobStatus("succeeded")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("canceled")).toBe(true);
    expect(isTerminalJobStatus("queued")).toBe(false);
    expect(isTerminalJobStatus("leased")).toBe(false);
    expect(isTerminalJobStatus("running")).toBe(false);
  });

  it("builds cancel patches that clear lease state and stale run errors", () => {
    const now = 123;
    expect(cancelJobPatch(now)).toEqual({
      status: "canceled",
      finishedAt: 123,
      payload: undefined,
      leaseId: undefined,
      leasedByRunnerId: undefined,
      leaseExpiresAt: undefined,
      errorMessage: undefined,
    });
    expect(cancelRunPatch(now)).toEqual({
      status: "canceled",
      finishedAt: 123,
      errorMessage: undefined,
    });
  });
});
