import { describe, expect, it, vi } from "vitest"
import { putRunnerCommandResult } from "../convex/controlPlane/jobCommandResults"
import { storeRunnerCommandResultBlob } from "../convex/controlPlane/jobCommandResultBlobs"

function makeMutationCtx() {
  const db = {
    query: vi.fn(() => ({
      withIndex: vi.fn(() => ({
        collect: vi.fn(async () => []),
      })),
    })),
    delete: vi.fn(async () => null),
    insert: vi.fn(async () => "row-1"),
  }
  return { db }
}

describe("runner command result size limits", () => {
  it("rejects small-result JSON above UTF-8 byte limit", async () => {
    const value = "é".repeat(300_000)
    const payload = JSON.stringify({ value })
    expect(payload.length).toBeLessThan(512 * 1024)
    expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(512 * 1024)

    const ctx = makeMutationCtx()
    await expect(
      putRunnerCommandResult({
        ctx: ctx as any,
        projectId: "p1" as any,
        runId: "r1" as any,
        jobId: "j1" as any,
        commandResultJson: payload,
        now: 1,
      }),
    ).rejects.toThrow(/too large/i)
    expect(ctx.db.insert).not.toHaveBeenCalled()
  })

  it("rejects large-result JSON above UTF-8 byte limit", async () => {
    const value = "é".repeat(2_700_000)
    const payload = JSON.stringify({ value })
    expect(payload.length).toBeLessThan(5 * 1024 * 1024)
    expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(5 * 1024 * 1024)

    const storage = { store: vi.fn(async () => "s1") }
    await expect(
      storeRunnerCommandResultBlob({
        ctx: { storage } as any,
        commandResultLargeJson: payload,
      }),
    ).rejects.toThrow(/too large/i)
    expect(storage.store).not.toHaveBeenCalled()
  }, 20_000)
})
