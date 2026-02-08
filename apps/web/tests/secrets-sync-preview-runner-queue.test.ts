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

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation: vi.fn(), query: vi.fn() }) as any,
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
      listRunMessages: async () => [JSON.stringify({
        localDir: "/runner/repo/secrets/alpha",
        remoteDir: "/etc/clawlets/hosts/alpha/secrets",
        digest: "sha256",
        files: ["DISCORD_TOKEN.yaml"],
      })],
      parseLastJsonMessage: (messages: string[]) => JSON.parse(messages[messages.length - 1] || "{}"),
      lastErrorMessage: () => "preview failed",
    }
  })

  const mod = await import("~/sdk/secrets/sync")
  return { mod, enqueueRunnerCommand }
}

describe("secrets sync preview runner queue", () => {
  it("loads preview from runner JSON", async () => {
    const { mod, enqueueRunnerCommand } = await loadSdk()
    const context = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }
    const res = await runWithStartContext(context, async () =>
      await mod.secretsSyncPreview({
        data: { projectId: "p1" as any, host: "alpha" },
      }),
    )

    expect(res).toEqual({
      ok: true,
      localDir: "/runner/repo/secrets/alpha",
      remoteDir: "/etc/clawlets/hosts/alpha/secrets",
      digest: "sha256",
      files: ["DISCORD_TOKEN.yaml"],
    })
    expect(enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      host: "alpha",
      args: ["secrets", "sync", "--host", "alpha", "--preview-json"],
    }))
  })
})
