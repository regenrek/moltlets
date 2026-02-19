import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadSdk() {
  vi.resetModules()
  const enqueueRunnerCommand = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }))
  const runnerJson = {
    ok: true,
    host: "alpha",
    branch: "main",
    upstream: "origin/main",
    localHead: "abc123",
    originDefaultRef: "origin/main",
    originHead: "def456",
    dirty: false,
    ahead: 2,
    behind: 0,
    detached: false,
    needsPush: true,
    canPush: true,
    sha: "new-sha",
    committed: true,
    pushed: true,
    changedPaths: ["fleet/clawlets.json"],
  }

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () =>
      ({
        mutation: vi.fn(async (_mutation: unknown, payload: any) => {
          const maybeTakeResult =
            payload
            && typeof payload === "object"
            && typeof payload.projectId === "string"
            && typeof payload.jobId === "string"
            && !("kind" in payload)
            && !("sealedInputB64" in payload)
          if (maybeTakeResult) return { runId: "run_1", resultJson: JSON.stringify(runnerJson) }
          return null
        }),
        query: vi.fn(),
      }) as any,
  }))
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess: async () => ({ role: "admin" }),
  }))
  vi.doMock("~/sdk/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sdk/runtime")>()
    return {
      ...actual,
      enqueueRunnerCommand,
      waitForRunTerminal: async () => ({ status: "succeeded" }),
      listRunMessages: async () => [JSON.stringify(runnerJson)],
      parseLastJsonMessage: (messages: string[]) => JSON.parse(messages[messages.length - 1] || "{}"),
      lastErrorMessage: () => "git status failed",
    }
  })

  const mod = await import("~/domains/vcs/git")
  return { mod, enqueueRunnerCommand }
}

describe("git status runner queue", () => {
  it("reads git status from runner JSON", async () => {
    const { mod, enqueueRunnerCommand } = await loadSdk()
    const context = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }

    const res = await runWithStartContext(context, async () =>
      await mod.gitRepoStatus({ data: { projectId: "p1" as any } }),
    )

    expect(res).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      localHead: "abc123",
      originHead: "def456",
      needsPush: true,
      canPush: true,
    })
    expect(enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      args: ["git", "status", "--json"],
    }))
  })

  it("queues git push via canonical runner command path", async () => {
    const { mod, enqueueRunnerCommand } = await loadSdk()
    const context = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }

    const res = await runWithStartContext(context, async () =>
      await mod.gitPushExecute({ data: { projectId: "p1" as any } }),
    )

    expect(res.ok).toBe(true)
    expect(res.queued).toBe(true)
    expect(enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      runKind: "git_push",
      args: ["git", "push"],
    }))
  })

  it("queues git setup-save and returns pinned sha", async () => {
    const { mod, enqueueRunnerCommand } = await loadSdk()
    const context = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }

    const res = await runWithStartContext(context, async () =>
      await mod.gitSetupSaveExecute({ data: { projectId: "p1" as any, host: "alpha" } }),
    )

    expect(res.ok).toBe(true)
    expect(res.result.sha).toBe("new-sha")
    expect(enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      runKind: "custom",
      args: ["git", "setup-save", "--host", "alpha", "--json"],
    }))
  })
})
