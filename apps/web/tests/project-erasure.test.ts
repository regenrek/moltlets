import { describe, expect, it } from "vitest"

import {
  __test_constantTimeEqual,
  __test_hasActiveLease,
  __test_isDeleteTokenValid,
  __test_randomToken,
  __test_sha256Hex,
} from "../convex/projectErasure"

describe("project erasure primitives", () => {
  it("generates base64url tokens", () => {
    const tok = __test_randomToken()
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(tok).toHaveLength(43)
  })

  it("computes sha256 hex", async () => {
    const h = await __test_sha256Hex("abc")
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  it("does constant-time compares", () => {
    expect(__test_constantTimeEqual("aaa", "aaa")).toBe(true)
    expect(__test_constantTimeEqual("aaa", "aab")).toBe(false)
    expect(__test_constantTimeEqual("aa", "aaa")).toBe(false)
  })

  it("validates delete token hashes with expiry", async () => {
    const token = "token123"
    const tokenHash = await __test_sha256Hex(token)
    expect(
      __test_isDeleteTokenValid({
        tokens: [{ tokenHash, expiresAt: 100 }],
        now: 100,
        tokenHash,
      }),
    ).toBe(true)
    expect(
      __test_isDeleteTokenValid({
        tokens: [{ tokenHash, expiresAt: 99 }],
        now: 100,
        tokenHash,
      }),
    ).toBe(false)
    expect(
      __test_isDeleteTokenValid({
        tokens: [{ tokenHash, expiresAt: 100 }],
        now: 100,
        tokenHash: `${tokenHash}x`,
      }),
    ).toBe(false)
  })

  it("tracks active leases", () => {
    expect(__test_hasActiveLease(undefined, 100)).toBe(false)
    expect(__test_hasActiveLease(100, 100)).toBe(false)
    expect(__test_hasActiveLease(101, 100)).toBe(true)
  })
})

