import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadConfig(role: "admin" | "viewer") {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; jobId?: string }) => {
    if (payload?.kind) return { runId: "run1", jobId: "job1" }
    if (payload?.jobId) {
      return { runId: "run1", resultJson: JSON.stringify({ fleet: { codex: { enable: true } } }) }
    }
    return null
  })
  const query = vi.fn(async (_query: unknown, payload?: Record<string, unknown>) => {
    if (payload?.["runId"]) {
      return { role, run: { projectId: "p1", status: "succeeded", errorMessage: undefined } }
    }
    if (payload?.["paginationOpts"]) {
      return { page: [{ message: "{}" }] }
    }
    return { project: { executionMode: "remote_runner" }, role }
  })

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("@clawlets/core/lib/config/clawlets-config", async () => {
    const actual = await vi.importActual<typeof import("@clawlets/core/lib/config/clawlets-config")>(
      "@clawlets/core/lib/config/clawlets-config",
    )
    return {
      ...actual,
      ClawletsConfigSchema: {
        safeParse: (value: unknown) => ({ success: true, data: value }),
      },
    }
  })

  const mod = await import("~/sdk/config")
  return { mod, mutation }
}

describe("config admin guard", () => {
  it("blocks viewer from writing config", async () => {
    const { mod, mutation } = await loadConfig("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.writeClawletsConfigFile({
            data: { projectId: "p1" as any, next: {}, title: "write config" },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
  })

  it("blocks viewer from config dot-get", async () => {
    const { mod, mutation } = await loadConfig("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.configDotGet({
            data: { projectId: "p1" as any, path: "fleet.codex.enable" },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
  })

  it("blocks viewer from config dot-multi-get", async () => {
    const { mod, mutation } = await loadConfig("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.configDotMultiGet({
            data: { projectId: "p1" as any, paths: ["fleet.codex.enable"] },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
  })

  it("allows admin to write config", async () => {
    const { mod, mutation } = await loadConfig("admin")
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.writeClawletsConfigFile({
          data: { projectId: "p1" as any, next: {}, title: "write config" },
        }),
    )
    expect(res.ok).toBe(true)
    expect(mutation).toHaveBeenCalled()
  })

  it("allows admin to read config dot-multi-get", async () => {
    const { mod, mutation } = await loadConfig("admin")
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotMultiGet({
          data: { projectId: "p1" as any, paths: ["fleet.codex.enable"] },
        }),
    )
    expect(res.values).toHaveProperty("fleet.codex.enable")
    expect(mutation).toHaveBeenCalled()
  })
})
