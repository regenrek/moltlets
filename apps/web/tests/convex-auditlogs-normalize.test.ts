import { ConvexError } from "convex/values"
import { describe, expect, it } from "vitest"

import { normalizeBoundedStringArrayForAudit } from "../convex/security/auditLogs"

function expectConvexFail(fn: () => void, code: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
  }
}

describe("auditLogs normalizeBoundedStringArray", () => {
  it("trims and drops empty strings", () => {
    expect(normalizeBoundedStringArrayForAudit(["  a  ", "", "b"])).toEqual(["a", "b"])
  })

  it("truncates long strings", () => {
    const out = normalizeBoundedStringArrayForAudit(["x".repeat(10_000)])
    expect(out).toHaveLength(1)
    expect(out[0]?.length).toBeLessThanOrEqual(256)
  })

  it("caps maximum items", () => {
    const input = Array.from({ length: 250 }, (_, i) => `k${i}`)
    const out = normalizeBoundedStringArrayForAudit(input)
    expect(out.length).toBe(200)
    expect(out[0]).toBe("k0")
    expect(out[out.length - 1]).toBe("k199")
  })

  it("rejects non-array input", () => {
    expectConvexFail(() => normalizeBoundedStringArrayForAudit({} as any), "conflict")
  })
})

