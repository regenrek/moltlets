import { ConvexError } from "convex/values"
import { describe, expect, it } from "vitest"

import { ensureAuditRepoRelativePath } from "../convex/security/auditLogs"

function expectConvexFail(fn: () => void, code: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
  }
}

describe("auditLogs ensureRepoRelativePath", () => {
  it("accepts trimmed repo-relative paths", () => {
    expect(ensureAuditRepoRelativePath("  fleet/clawlets.json  ")).toBe("fleet/clawlets.json")
  })

  it("normalizes backslashes to forward slashes", () => {
    expect(ensureAuditRepoRelativePath("a\\b")).toBe("a/b")
  })

  it("rejects absolute paths", () => {
    expectConvexFail(() => ensureAuditRepoRelativePath("/etc/passwd"), "conflict")
    expectConvexFail(() => ensureAuditRepoRelativePath("//server/share"), "conflict")
  })

  it("rejects Windows drive absolute paths", () => {
    expectConvexFail(() => ensureAuditRepoRelativePath("C:/Windows/System32"), "conflict")
  })

  it("rejects parent traversal", () => {
    expectConvexFail(() => ensureAuditRepoRelativePath("../secrets"), "conflict")
    expectConvexFail(() => ensureAuditRepoRelativePath("a/../b"), "conflict")
    expectConvexFail(() => ensureAuditRepoRelativePath("a/.."), "conflict")
  })

  it("rejects NUL and newlines", () => {
    expectConvexFail(() => ensureAuditRepoRelativePath("a\0b"), "conflict")
    expectConvexFail(() => ensureAuditRepoRelativePath("a\nb"), "conflict")
    expectConvexFail(() => ensureAuditRepoRelativePath("a\rb"), "conflict")
  })
})
