import { describe, expect, it } from "vitest"

import {
  __test_constantTimeEqual,
  __test_hasActiveLease,
  __test_isDeleteTokenValid,
  __test_randomToken,
  __test_sha256Hex,
} from "../convex/projectErasure"

describe("project erasure crypto helpers", () => {
  it("sha256Hex matches a known vector", async () => {
    await expect(__test_sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("randomToken returns base64url without padding", () => {
    const token = __test_randomToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).not.toContain("=")
    expect(token.length).toBeGreaterThanOrEqual(40)
  })

  it("constantTimeEqual compares strings correctly", () => {
    expect(__test_constantTimeEqual("a", "a")).toBe(true)
    expect(__test_constantTimeEqual("a", "b")).toBe(false)
    expect(__test_constantTimeEqual("a", "aa")).toBe(false)
  })

  it("hasActiveLease uses leaseExpiresAt", () => {
    const now = 1_000
    expect(__test_hasActiveLease(undefined, now)).toBe(false)
    expect(__test_hasActiveLease(now, now)).toBe(false)
    expect(__test_hasActiveLease(now + 1, now)).toBe(true)
  })

  it("isDeleteTokenValid checks expiry and hash", () => {
    const now = 1_000
    expect(
      __test_isDeleteTokenValid({
        now,
        tokenHash: "abc",
        tokens: [{ tokenHash: "abc", expiresAt: now - 1 }],
      }),
    ).toBe(false)
    expect(
      __test_isDeleteTokenValid({
        now,
        tokenHash: "abc",
        tokens: [{ tokenHash: "abc", expiresAt: now }],
      }),
    ).toBe(true)
    expect(
      __test_isDeleteTokenValid({
        now,
        tokenHash: "abc",
        tokens: [{ tokenHash: "abcd", expiresAt: now }],
      }),
    ).toBe(false)
  })
})
