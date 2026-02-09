import { describe, expect, it } from "vitest"
import { ConvexError } from "convex/values"
import { __test_normalizeRunnerRepoPath, validateProjectCreateMode } from "../convex/controlPlane/projects"

function expectConvexFail(fn: () => void, code: string, message: string) {
  try {
    fn()
    throw new Error("expected fail")
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError)
    expect((err as any).data?.code).toBe(code)
    expect((err as any).data?.message).toBe(message)
  }
}

describe("projects.create mode validation", () => {
  it("rejects remote_runner without runnerRepoPath", () => {
    expectConvexFail(
      () =>
        validateProjectCreateMode({
          executionMode: "remote_runner",
          localPath: "",
          workspaceRefKind: "git",
        }),
      "conflict",
      "runnerRepoPath required for remote_runner execution mode",
    )
  })

  it("rejects remote_runner with localPath", () => {
    expectConvexFail(
      () =>
        validateProjectCreateMode({
          executionMode: "remote_runner",
          localPath: "/tmp/repo",
          runnerRepoPath: "/srv/repo",
          workspaceRefKind: "git",
        }),
      "conflict",
      "localPath forbidden for remote_runner execution mode",
    )
  })

  it("rejects local with runnerRepoPath", () => {
    expectConvexFail(
      () =>
        validateProjectCreateMode({
          executionMode: "local",
          localPath: "/tmp/repo",
          runnerRepoPath: "/srv/repo",
          workspaceRefKind: "local",
        }),
      "conflict",
      "runnerRepoPath forbidden for local execution mode",
    )
  })

  it("normalizes runnerRepoPath slashes and trailing slash", () => {
    expect(__test_normalizeRunnerRepoPath(" ~/.clawlets//projects\\fleet-a/ ")).toBe("~/.clawlets/projects/fleet-a")
  })

  it("rejects runnerRepoPath traversal segments", () => {
    expectConvexFail(
      () => __test_normalizeRunnerRepoPath("~/.clawlets/projects/../escape"),
      "conflict",
      "runnerRepoPath cannot contain '..' path segments",
    )
  })

  it("rejects runnerRepoPath traversal after slash normalization", () => {
    expectConvexFail(
      () => __test_normalizeRunnerRepoPath("~\\.clawlets\\projects\\..\\escape"),
      "conflict",
      "runnerRepoPath cannot contain '..' path segments",
    )
  })

  it("rejects bare runnerRepoPath '..'", () => {
    expectConvexFail(
      () => __test_normalizeRunnerRepoPath(".."),
      "conflict",
      "runnerRepoPath cannot contain '..' path segments",
    )
  })

  it("rejects runnerRepoPath forbidden characters", () => {
    expectConvexFail(
      () => __test_normalizeRunnerRepoPath("~/.clawlets/projects/fleet\nbad"),
      "conflict",
      "runnerRepoPath contains forbidden characters",
    )
  })

  it("returns undefined for empty runnerRepoPath", () => {
    expect(__test_normalizeRunnerRepoPath("")).toBeUndefined()
    expect(__test_normalizeRunnerRepoPath("   ")).toBeUndefined()
  })

  it("rejects runnerRepoPath exceeding max length", () => {
    expectConvexFail(
      () => __test_normalizeRunnerRepoPath("a".repeat(513)),
      "conflict",
      "runnerRepoPath too long",
    )
  })
})
