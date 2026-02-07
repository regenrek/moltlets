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
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { executionMode: "local", localPath: "/tmp" }, role }))
  const runWithEvents = vi.fn(async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
    await fn(async () => {})
  })

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/server/redaction", () => ({ readClawletsEnvTokens: async () => [] }))
  vi.doMock("~/server/run-manager", () => ({
    runWithEvents,
  }))
  vi.doMock("@clawlets/core/lib/openclaw/schema/validate", () => ({
    validateOpenclawConfig: () => ({ ok: true }),
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
      loadFullConfig: () => ({
        infraConfigPath: "/tmp/fleet/clawlets.json",
        config: { hosts: { alpha: { gatewaysOrder: ["gateway1"], gateways: { gateway1: { openclaw: {} } } } } },
      }),
      writeClawletsConfig: async () => {},
    }
  })

  const mod = await import("~/sdk/openclaw")
  return { mod, mutation, runWithEvents }
}

describe("gateways admin guard", () => {
  it("blocks viewer from mutating gateway config", async () => {
    const { mod, mutation, runWithEvents } = await loadGateways("viewer")
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
    expect(runWithEvents).not.toHaveBeenCalled()
  })

  it("allows admin to mutate gateway config", async () => {
    const { mod } = await loadGateways("admin")
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
  })
})
