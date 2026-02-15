import { describe, expect, it } from "vitest"
import { __test_isDeployCredsSummaryStale } from "../src/lib/setup/use-setup-model"

describe("setup deploy creds summary staleness", () => {
  it("treats missing timestamps as stale", () => {
    expect(__test_isDeployCredsSummaryStale({ updatedAtMs: 0, nowMs: 1_000_000 })).toBe(true)
    expect(__test_isDeployCredsSummaryStale({ updatedAtMs: "bad", nowMs: 1_000_000 })).toBe(true)
  })

  it("treats fresh timestamps as not stale", () => {
    const nowMs = 1_000_000
    expect(__test_isDeployCredsSummaryStale({
      updatedAtMs: nowMs - 59_999,
      nowMs,
      staleMs: 60_000,
    })).toBe(false)
  })

  it("treats timestamps at or past threshold as stale", () => {
    const nowMs = 1_000_000
    expect(__test_isDeployCredsSummaryStale({
      updatedAtMs: nowMs - 60_000,
      nowMs,
      staleMs: 60_000,
    })).toBe(true)
    expect(__test_isDeployCredsSummaryStale({
      updatedAtMs: nowMs - 70_000,
      nowMs,
      staleMs: 60_000,
    })).toBe(true)
  })
})
