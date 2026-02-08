import { describe, expect, it } from "vitest";
import {
  __test_canCompleteJob,
  __test_cancelJobPatch,
  __test_cancelRunPatch,
  __test_isTerminalJobStatus,
} from "../convex/jobs";

describe("job completion guard", () => {
  it("rejects lease mismatch", () => {
    const res = __test_canCompleteJob({
      job: { status: "running", leaseId: "lease-a", leaseExpiresAt: 200 },
      leaseId: "lease-b",
      now: 100,
    });
    expect(res).toEqual({ ok: false, status: "running" });
  });

  it("rejects canceled and queued jobs", () => {
    expect(
      __test_canCompleteJob({
        job: { status: "canceled", leaseId: "lease-a", leaseExpiresAt: 200 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "canceled" });
    expect(
      __test_canCompleteJob({
        job: { status: "queued", leaseId: "lease-a", leaseExpiresAt: 200 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "queued" });
  });

  it("rejects expired leases and accepts valid running lease", () => {
    expect(
      __test_canCompleteJob({
        job: { status: "running", leaseId: "lease-a", leaseExpiresAt: 100 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "running" });
    expect(
      __test_canCompleteJob({
        job: { status: "running", leaseId: "lease-a", leaseExpiresAt: 200 },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: true, status: "running" });
  });

  it("rejects missing lease expiry", () => {
    expect(
      __test_canCompleteJob({
        job: { status: "running", leaseId: "lease-a" },
        leaseId: "lease-a",
        now: 100,
      }),
    ).toEqual({ ok: false, status: "running" });
  });

  it("classifies terminal job statuses", () => {
    expect(__test_isTerminalJobStatus("succeeded")).toBe(true);
    expect(__test_isTerminalJobStatus("failed")).toBe(true);
    expect(__test_isTerminalJobStatus("canceled")).toBe(true);
    expect(__test_isTerminalJobStatus("queued")).toBe(false);
    expect(__test_isTerminalJobStatus("leased")).toBe(false);
    expect(__test_isTerminalJobStatus("running")).toBe(false);
  });

  it("builds cancel patches that clear lease state and stale run errors", () => {
    const now = 123;
    expect(__test_cancelJobPatch(now)).toEqual({
      status: "canceled",
      finishedAt: 123,
      payload: undefined,
      leaseId: undefined,
      leasedByRunnerId: undefined,
      leaseExpiresAt: undefined,
      errorMessage: undefined,
    });
    expect(__test_cancelRunPatch(now)).toEqual({
      status: "canceled",
      finishedAt: 123,
      errorMessage: undefined,
    });
  });
});
