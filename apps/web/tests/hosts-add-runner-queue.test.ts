import { AsyncLocalStorage } from "node:async_hooks"
import { describe, expect, it, vi } from "vitest"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

function startContext() {
  return {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  }
}

async function loadHostsSdk(params: {
  runnerOnline: boolean
  existingHosts?: string[]
  terminalStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled"
}) {
  vi.resetModules()
  const terminalStatus = params.terminalStatus ?? "succeeded"
  const existingHosts = params.existingHosts ?? []
  const listRunMessages = vi.fn(async () => ["error: host add failed"])
  const enqueueRunnerCommand = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }))
  const mutation = vi.fn(async () => ({ hostId: "host_1" }))
  const now = Date.now()
  let projectQueryCount = 0
  const query = vi.fn(async (_query: unknown, payload?: { projectId?: string }) => {
    if (payload?.projectId) {
      if (!params.runnerOnline) return []
      projectQueryCount += 1
      if (projectQueryCount === 1) {
        return [{ runnerName: "runner-a", lastStatus: "online", lastSeenAt: now }]
      }
      return existingHosts.map((hostName) => ({ hostName }))
    }
    return null
  })

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query, action: vi.fn() }) as any,
  }))
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess: async () => ({ role: "admin" }),
  }))
  vi.doMock("~/sdk/config/dot", () => ({
    configDotGet: vi.fn(),
    configDotSet: vi.fn(),
    configDotBatch: vi.fn(),
  }))
  vi.doMock("~/sdk/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sdk/runtime")>()
    return {
      ...actual,
      enqueueRunnerCommand,
      waitForRunTerminal: async () => ({
        status: terminalStatus,
        errorMessage: terminalStatus === "failed" ? "runner failed" : undefined,
      }),
      listRunMessages,
      lastErrorMessage: () => "host add failed",
    }
  })

  const mod = await import("~/sdk/config/hosts")
  return { mod, enqueueRunnerCommand, mutation, listRunMessages }
}

describe("hosts add runner queue", () => {
  it("queues canonical host add command and upserts on quick success", async () => {
    const { mod, enqueueRunnerCommand, mutation } = await loadHostsSdk({ runnerOnline: true })

    const res = await runWithStartContext(startContext(), async () =>
      await mod.addHost({ data: { projectId: "p1" as any, host: "alpha" } }),
    )

    expect(res).toMatchObject({ ok: true, queued: false })
    expect(enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      runKind: "config_write",
      args: ["host", "add", "--host", "alpha"],
    }))
    expect(mutation).toHaveBeenCalledTimes(1)
  })

  it("fails fast when runner is offline", async () => {
    const { mod, enqueueRunnerCommand, mutation } = await loadHostsSdk({ runnerOnline: false })

    await expect(
      runWithStartContext(startContext(), async () =>
        await mod.addHost({ data: { projectId: "p1" as any, host: "alpha" } }),
      ),
    ).rejects.toThrow(/Runner offline/i)

    expect(enqueueRunnerCommand).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })

  it("returns queued=true when run is still in progress", async () => {
    const { mod, enqueueRunnerCommand, mutation, listRunMessages } = await loadHostsSdk({
      runnerOnline: true,
      terminalStatus: "running",
    })

    const res = await runWithStartContext(startContext(), async () =>
      await mod.addHost({ data: { projectId: "p1" as any, host: "alpha" } }),
    )

    expect(res).toMatchObject({ ok: true, queued: true, runId: "run_1", jobId: "job_1" })
    expect(enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    expect(mutation).not.toHaveBeenCalled()
    expect(listRunMessages).not.toHaveBeenCalled()
  })

  it("does not enqueue when host already exists in control-plane rows", async () => {
    const { mod, enqueueRunnerCommand, mutation } = await loadHostsSdk({
      runnerOnline: true,
      existingHosts: ["alpha"],
    })

    const res = await runWithStartContext(startContext(), async () =>
      await mod.addHost({ data: { projectId: "p1" as any, host: "alpha" } }),
    )

    expect(res).toMatchObject({ ok: true, queued: false, alreadyExists: true })
    expect(enqueueRunnerCommand).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })
})
