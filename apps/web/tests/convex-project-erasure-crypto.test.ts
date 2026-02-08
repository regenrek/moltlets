import { describe, expect, it } from "vitest"

import {
  constantTimeEqual,
  hasActiveLease,
  isDeleteTokenValid,
  randomToken,
  sha256Hex,
} from "../convex/controlPlane/projectErasureHelpers"

describe("project erasure crypto helpers", () => {
  it("sha256Hex matches a known vector", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("randomToken returns base64url without padding", () => {
    const token = randomToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).not.toContain("=")
    expect(token.length).toBeGreaterThanOrEqual(40)
  })

  it("constantTimeEqual compares strings correctly", () => {
    expect(constantTimeEqual("a", "a")).toBe(true)
    expect(constantTimeEqual("a", "b")).toBe(false)
    expect(constantTimeEqual("a", "aa")).toBe(false)
  })

  it("hasActiveLease uses leaseExpiresAt", () => {
    const now = 1_000
    expect(hasActiveLease(undefined, now)).toBe(false)
    expect(hasActiveLease(now, now)).toBe(false)
    expect(hasActiveLease(now + 1, now)).toBe(true)
  })

  it("isDeleteTokenValid checks expiry and hash", () => {
    const now = 1_000
    expect(
      isDeleteTokenValid({
        now,
        tokenHash: "abc",
        tokens: [{ tokenHash: "abc", expiresAt: now - 1 }],
      }),
    ).toBe(false)
    expect(
      isDeleteTokenValid({
        now,
        tokenHash: "abc",
        tokens: [{ tokenHash: "abc", expiresAt: now }],
      }),
    ).toBe(true)
    expect(
      isDeleteTokenValid({
        now,
        tokenHash: "abc",
        tokens: [{ tokenHash: "abcd", expiresAt: now }],
      }),
    ).toBe(false)
  })
})
