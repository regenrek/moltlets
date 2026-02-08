import { describe, expect, it } from "vitest"

import {
  constantTimeEqual,
  canReadDeleteStatusAfterProjectRemoval,
  hasActiveLease,
  isDeleteTokenValid,
  nextStage,
  randomToken,
  sha256Hex,
} from "../convex/controlPlane/projectErasureHelpers"
import { PROJECT_DELETION_STAGES } from "../convex/shared/projectErasureStages"

describe("project erasure primitives", () => {
  it("generates base64url tokens", () => {
    const tok = randomToken()
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tok).toHaveLength(43)
  })

  it("computes sha256 hex", async () => {
    const h = await sha256Hex("abc")
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  it("does constant-time compares", () => {
    expect(constantTimeEqual("aaa", "aaa")).toBe(true)
    expect(constantTimeEqual("aaa", "aab")).toBe(false)
    expect(constantTimeEqual("aa", "aaa")).toBe(false)
  })

  it("validates delete token hashes with expiry", async () => {
    const token = "token123"
    const tokenHash = await sha256Hex(token)
    expect(
      isDeleteTokenValid({
        tokens: [{ tokenHash, expiresAt: 100 }],
        now: 100,
        tokenHash,
      }),
    ).toBe(true)
    expect(
      isDeleteTokenValid({
        tokens: [{ tokenHash, expiresAt: 99 }],
        now: 100,
        tokenHash,
      }),
    ).toBe(false)
    expect(
      isDeleteTokenValid({
        tokens: [{ tokenHash, expiresAt: 100 }],
        now: 100,
        tokenHash: `${tokenHash}x`,
      }),
    ).toBe(false)
  })

  it("tracks active leases", () => {
    expect(hasActiveLease(undefined, 100)).toBe(false)
    expect(hasActiveLease(100, 100)).toBe(false)
    expect(hasActiveLease(101, 100)).toBe(true)
  })

  it("advances through all deletion stages", () => {
    expect(PROJECT_DELETION_STAGES).toHaveLength(16)
    for (let i = 0; i < PROJECT_DELETION_STAGES.length - 1; i += 1) {
      const current = PROJECT_DELETION_STAGES[i]!
      const next = PROJECT_DELETION_STAGES[i + 1]!
      expect(nextStage(current as any)).toBe(next)
    }
    expect(nextStage("done")).toBe("done")
  })

  it("allows delete status fallback for requester/admin after project removal", () => {
    expect(
      canReadDeleteStatusAfterProjectRemoval({
        authedUserId: "u1",
        authedRole: "viewer",
        requestedByUserId: "u1",
      }),
    ).toBe(true)
    expect(
      canReadDeleteStatusAfterProjectRemoval({
        authedUserId: "u2",
        authedRole: "viewer",
        requestedByUserId: "u1",
      }),
    ).toBe(false)
    expect(
      canReadDeleteStatusAfterProjectRemoval({
        authedUserId: "u2",
        authedRole: "admin",
        requestedByUserId: "u1",
      }),
    ).toBe(true)
  })
})
