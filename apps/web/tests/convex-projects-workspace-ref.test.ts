import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"

import { __test_normalizeWorkspaceRef } from "../convex/projects"

function expectConvexFail(fn: () => void, code: string, message?: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
    if (message) expect((err as any).data?.message).toBe(message)
  }
}

describe("workspaceRef normalization", () => {
  it("builds canonical key with trimmed relPath", () => {
    expect(
      __test_normalizeWorkspaceRef({
        kind: "git",
        id: "repo-123",
        relPath: "  fleet/prod  ",
      }),
    ).toEqual({
      kind: "git",
      id: "repo-123",
      relPath: "fleet/prod",
      key: "git:repo-123:fleet/prod",
    })
  })

  it("rejects missing id", () => {
    expectConvexFail(
      () => __test_normalizeWorkspaceRef({ kind: "local", id: "   " }),
      "conflict",
      "workspaceRef.id required",
    )
  })

  it("rejects oversized relPath", () => {
    expectConvexFail(
      () => __test_normalizeWorkspaceRef({ kind: "git", id: "repo-1", relPath: "a".repeat(257) }),
      "conflict",
      "workspaceRef.relPath too long",
    )
  })
})
