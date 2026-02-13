import { describe, expect, it, vi } from "vitest"
import { normalizeRunnerLeaseWaitOptions, runLeaseNextWithWait } from "../convex/shared/runnerLeaseWait"

describe("runner lease wait helper", () => {
  it("clamps wait options to bounded values", () => {
    const out = normalizeRunnerLeaseWaitOptions({
      waitMsRaw: 120_000,
      waitPollMsRaw: 1,
      nowMs: 10,
    })
    expect(out).toEqual({
      waitMs: 60_000,
      waitPollMs: 2_000,
      waitApplied: true,
      deadlineMs: 60_010,
    })
  })

  it("returns immediately when wait is disabled", async () => {
    const leaseNext = vi.fn(async () => null)
    const sleep = vi.fn(async (_ms: number) => {})
    const out = await runLeaseNextWithWait({
      leaseNext,
      sleep,
      waitMsRaw: 0,
      waitPollMsRaw: 8_000,
      now: () => 0,
    })
    expect(out).toEqual({ job: null, waitApplied: false })
    expect(leaseNext).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("checks one final lease at deadline before returning null", async () => {
    let nowMs = 0
    const leaseNext = vi.fn(async () => null)
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms
    })
    const out = await runLeaseNextWithWait({
      leaseNext,
      sleep,
      waitMsRaw: 1_000,
      waitPollMsRaw: 400,
      now: () => nowMs,
    })
    expect(out).toEqual({ job: null, waitApplied: true })
    expect(leaseNext).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1_000])
  })

  it("returns a job discovered during the wait window", async () => {
    let nowMs = 0
    const queue: Array<{ id: string } | null> = [null, null, { id: "job-1" }]
    const leaseNext = vi.fn(async () => queue.shift() ?? null)
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms
    })
    const out = await runLeaseNextWithWait({
      leaseNext,
      sleep,
      waitMsRaw: 4_500,
      waitPollMsRaw: 600,
      now: () => nowMs,
    })
    expect(out).toEqual({ job: { id: "job-1" }, waitApplied: true })
    expect(leaseNext).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([2_000, 2_000])
  })
})
