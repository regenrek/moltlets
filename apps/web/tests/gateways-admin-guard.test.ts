import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadGateways(role: "admin" | "viewer") {
  vi.resetModules()
  const configDotGet = vi.fn(async (_params: unknown) => ({
    path: "hosts.alpha.gateways.gateway1",
    value: { openclaw: {}, channels: {} },
  }))
  const configDotSet = vi.fn(async (_params: unknown) => ({ ok: true as const, runId: "run1" }))
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
    if (payload?.kind) return { runId: "run1", jobId: "job1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { executionMode: "remote_runner" }, role }))

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/sdk/config/dot", () => ({
    configDotGet,
    configDotSet,
  }))
  vi.doMock("@clawlets/core/lib/openclaw/schema/validate", () => ({
    validateOpenclawConfig: () => ({ ok: true }),
  }))

  const mod = await import("~/sdk/openclaw")
  return { mod, mutation, configDotGet, configDotSet }
}

describe("gateways admin guard", () => {
  it("blocks viewer from mutating gateway config", async () => {
    const { mod, mutation, configDotGet, configDotSet } = await loadGateways("viewer")
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.setGatewayOpenclawConfig({
            data: {
              projectId: "p1" as any,
              gatewayId: "gateway1",
              openclaw: {},
              schemaMode: "pinned",
              host: "alpha",
            },
          }),
      ),
    ).rejects.toThrow(/admin required/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(configDotGet).not.toHaveBeenCalled()
    expect(configDotSet).not.toHaveBeenCalled()
  })

  it("allows admin to mutate gateway config", async () => {
    const { mod, mutation, configDotGet, configDotSet } = await loadGateways("admin")
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.setGatewayOpenclawConfig({
          data: {
            projectId: "p1" as any,
            gatewayId: "gateway1",
            openclaw: {},
            schemaMode: "pinned",
            host: "alpha",
          },
        }),
    )
    expect(res.ok).toBe(true)
    expect(configDotGet).toHaveBeenCalled()
    expect(configDotSet).toHaveBeenCalled()
    expect(mutation).toHaveBeenCalled()
  })
})
