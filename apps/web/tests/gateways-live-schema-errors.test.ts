import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

import { LIVE_SCHEMA_ERROR_FALLBACK } from "~/sdk/openclaw"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadGateways(options: {
  fetchLive?: () => Promise<{ ok: boolean; message?: string; schema?: { schema: Record<string, unknown> } }>
  validate?: () => { ok: boolean; issues?: Array<{ path: Array<string | number>; message: string }> }
}) {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { executionMode: "local", localPath: "/tmp" }, role: "admin" }))

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/server/redaction", () => ({ readClawletsEnvTokens: async () => [] }))
  vi.doMock("@clawlets/core/lib/openclaw/schema/validate", () => ({
    validateOpenclawConfig: options.validate ?? (() => ({ ok: true })),
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
        config: { hosts: { h1: { gatewaysOrder: ["gateway1"], gateways: { gateway1: { openclaw: {} } } } } },
      }),
      writeClawletsConfig: async () => {},
    }
  })
  vi.doMock("~/server/openclaw-schema.server", () => ({
    fetchOpenclawSchemaLive:
      options.fetchLive ?? (async () => ({ ok: true, schema: { schema: { type: "object" } } })),
  }))

  const mod = await import("~/sdk/openclaw")
  return { mod, mutation }
}

describe("setGatewayOpenclawConfig schema error mapping", () => {
  const context = {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  }

  it("returns schema error when live schema returns ok:false", async () => {
    const { mod, mutation } = await loadGateways({
      fetchLive: async () => ({ ok: false, message: "too many requests" }),
    })
    const res = await runWithStartContext(context, async () =>
      mod.setGatewayOpenclawConfig({
        data: { projectId: "p1" as any, gatewayId: "gateway1", host: "h1", schemaMode: "live", openclaw: {} },
      }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues).toEqual([{ code: "schema", path: [], message: "too many requests" }])
    }
    const runCreates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.kind)
    expect(runCreates).toHaveLength(0)
  })

  it("returns sanitized schema error when live schema throws", async () => {
    const { mod } = await loadGateways({
      fetchLive: async () => {
        throw new Error("ssh: connect to host 10.0.0.1 port 22: Connection timed out; cmd: bash -lc 'secret'")
      },
    })
    const res = await runWithStartContext(context, async () =>
      mod.setGatewayOpenclawConfig({
        data: { projectId: "p1" as any, gatewayId: "gateway1", host: "h1", schemaMode: "live", openclaw: {} },
      }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues).toEqual([{ code: "schema", path: [], message: LIVE_SCHEMA_ERROR_FALLBACK }])
    }
  })

  it("maps schema validation issues when pinned schema rejects", async () => {
    const { mod, mutation } = await loadGateways({
      validate: () => ({ ok: false, issues: [{ path: ["name"], message: "name: required" }] }),
    })
    const res = await runWithStartContext(context, async () =>
      mod.setGatewayOpenclawConfig({
        data: { projectId: "p1" as any, gatewayId: "gateway1", host: "h1", schemaMode: "pinned", openclaw: {} },
      }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues).toEqual([{ code: "schema", path: ["name"], message: "name: required" }])
    }
    const runCreates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.kind)
    expect(runCreates).toHaveLength(0)
  })

  it("rejects inline secrets before writing config", async () => {
    const { mod, mutation } = await loadGateways({})
    const res = await runWithStartContext(context, async () =>
      mod.setGatewayOpenclawConfig({
        data: {
          projectId: "p1" as any,
          gatewayId: "gateway1",
          host: "h1",
          schemaMode: "pinned",
          openclaw: { gateway: { auth: { token: "not-an-env-ref" } } },
        },
      }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("security")
      expect(res.issues[0]?.path).toEqual(["gateway", "auth", "token"])
    }
    const runCreates = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.kind)
    expect(runCreates).toHaveLength(0)
  })
})
