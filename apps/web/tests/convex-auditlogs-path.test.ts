import { ConvexError } from "convex/values"
import { describe, expect, it } from "vitest"

import { __test_ensureRepoRelativePath } from "../convex/auditLogs"

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
    expect(__test_ensureRepoRelativePath("  fleet/clawlets.json  ")).toBe("fleet/clawlets.json")
  })

  it("normalizes backslashes to forward slashes", () => {
    expect(__test_ensureRepoRelativePath("a\\b")).toBe("a/b")
  })

  it("rejects absolute paths", () => {
    expectConvexFail(() => __test_ensureRepoRelativePath("/etc/passwd"), "conflict")
    expectConvexFail(() => __test_ensureRepoRelativePath("//server/share"), "conflict")
  })

  it("rejects Windows drive absolute paths", () => {
    expectConvexFail(() => __test_ensureRepoRelativePath("C:/Windows/System32"), "conflict")
  })

  it("rejects parent traversal", () => {
    expectConvexFail(() => __test_ensureRepoRelativePath("../secrets"), "conflict")
    expectConvexFail(() => __test_ensureRepoRelativePath("a/../b"), "conflict")
    expectConvexFail(() => __test_ensureRepoRelativePath("a/.."), "conflict")
  })

  it("rejects NUL and newlines", () => {
    expectConvexFail(() => __test_ensureRepoRelativePath("a\0b"), "conflict")
    expectConvexFail(() => __test_ensureRepoRelativePath("a\nb"), "conflict")
    expectConvexFail(() => __test_ensureRepoRelativePath("a\rb"), "conflict")
  })
})
