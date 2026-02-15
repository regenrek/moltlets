import { describe, expect, it } from "vitest"

import {
  getAuthErrorReason,
  isAuthError,
  isEnsureCurrentRequiredError,
  shouldRetryQueryError,
} from "../src/lib/auth-utils"

describe("isAuthError", () => {
  it("detects convex unauthorized codes", () => {
    expect(isAuthError({ data: { code: "unauthorized" } })).toBe(true)
  })

  it("detects unauth message text", () => {
    expect(isAuthError({ message: "Unauthenticated" })).toBe(true)
  })

  it("returns false for non-auth errors", () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError({ message: "forbidden" })).toBe(false)
  })

  it("detects structured auth reason", () => {
    expect(
      isAuthError({
        data: { code: "forbidden", reason: "ensure_current_required" },
      }),
    ).toBe(true)
  })
})

describe("isEnsureCurrentRequiredError", () => {
  it("detects ensureCurrent bootstrap errors", () => {
    expect(
      isEnsureCurrentRequiredError({
        data: { code: "unauthorized", message: "user missing (run users.ensureCurrent)" },
      }),
    ).toBe(true)
  })

  it("returns false for other auth errors", () => {
    expect(
      isEnsureCurrentRequiredError({
        data: { code: "unauthorized", message: "sign-in required" },
      }),
    ).toBe(false)
  })
})

describe("getAuthErrorReason", () => {
  it("returns structured reason when present", () => {
    expect(
      getAuthErrorReason({
        data: { code: "unauthorized", reason: "ensure_current_required" },
      }),
    ).toBe("ensure_current_required")
  })

  it("returns null for unknown reason", () => {
    expect(
      getAuthErrorReason({
        data: { code: "unauthorized", reason: "other" },
      }),
    ).toBeNull()
  })
})

describe("shouldRetryQueryError", () => {
  it("does not retry auth errors", () => {
    expect(
      shouldRetryQueryError(0, {
        data: { code: "unauthorized", reason: "sign_in_required" },
      }),
    ).toBe(false)
  })

  it("retries non-auth errors up to 3 attempts", () => {
    expect(shouldRetryQueryError(0, new Error("boom"))).toBe(true)
    expect(shouldRetryQueryError(2, new Error("boom"))).toBe(true)
    expect(shouldRetryQueryError(3, new Error("boom"))).toBe(false)
  })
})
