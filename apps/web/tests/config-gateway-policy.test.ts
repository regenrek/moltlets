import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadConfig() {
  vi.resetModules()
  const currentConfig = {
    hosts: { alpha: { gatewaysOrder: ["gateway1"], gateways: { gateway1: { openclaw: { ok: true } } } } },
  }
  const mutation = vi.fn(async (_mutation: unknown, payload?: Record<string, unknown>) => {
    if (payload?.["kind"]) return { runId: "run1", jobId: "job1" }
    if (typeof payload?.["projectId"] === "string" && typeof payload?.["jobId"] === "string") {
      return {
        runId: "run1",
        resultJson: JSON.stringify(currentConfig),
      }
    }
    return null
  })
  const query = vi.fn(async (_query: unknown, payload?: Record<string, unknown>) => {
    if (payload?.["paginationOpts"]) {
      return { page: [{ message: JSON.stringify(currentConfig) }] }
    }
    if (payload?.["runId"]) {
      return { role: "admin", run: { projectId: "p1", status: "succeeded", errorMessage: undefined } }
    }
    return { project: { executionMode: "remote_runner" }, role: "admin" }
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

describe("config gateway openclaw policy", () => {
  it("allows gateway channels updates via configDotSet", async () => {
    const { mod, mutation } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotSet({
          data: {
            projectId: "p1" as any,
            path: "hosts.alpha.gateways.gateway1.channels.discord.enabled",
            valueJson: "true",
            value: undefined,
            del: false,
          },
        }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.runId).toBe("run1")
    }
    expect(mutation).toHaveBeenCalled()
  })

  it("allows gateway channels updates via configDotBatch", async () => {
    const { mod, mutation } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotBatch({
          data: {
            projectId: "p1" as any,
            ops: [
              {
                path: "hosts.alpha.gateways.gateway1.channels.discord.enabled",
                valueJson: "true",
                del: false,
              },
            ],
          },
        }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.runId).toBe("run1")
    }
    expect(mutation).toHaveBeenCalled()
  })

  it("allows gateway hooks/skills/plugins updates via configDotSet", async () => {
    const { mod, mutation } = await loadConfig()
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }

    const hookRes = await runWithStartContext(ctx, async () =>
      mod.configDotSet({
        data: {
          projectId: "p1" as any,
          path: "hosts.alpha.gateways.gateway1.hooks.enabled",
          valueJson: "true",
          value: undefined,
          del: false,
        },
      }),
    )
    expect(hookRes.ok).toBe(true)

    const skillRes = await runWithStartContext(ctx, async () =>
      mod.configDotSet({
        data: {
          projectId: "p1" as any,
          path: "hosts.alpha.gateways.gateway1.skills.allowBundled",
          valueJson: '["brave-search"]',
          value: undefined,
          del: false,
        },
      }),
    )
    expect(skillRes.ok).toBe(true)

    const pluginRes = await runWithStartContext(ctx, async () =>
      mod.configDotSet({
        data: {
          projectId: "p1" as any,
          path: "hosts.alpha.gateways.gateway1.plugins.enabled",
          valueJson: "false",
          value: undefined,
          del: false,
        },
      }),
    )
    expect(pluginRes.ok).toBe(true)

    expect(mutation).toHaveBeenCalled()
  })

  it("rejects gateway openclaw path updates via configDotSet", async () => {
    const { mod, mutation } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotSet({
          data: {
            projectId: "p1" as any,
            path: "hosts.alpha.gateways.gateway1.openclaw.token",
            value: "nope",
            valueJson: undefined,
            del: false,
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("policy")
    }
    expect(mutation).not.toHaveBeenCalled()
  })

  it("rejects gateway openclaw path updates via configDotBatch", async () => {
    const { mod, mutation } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotBatch({
          data: {
            projectId: "p1" as any,
            ops: [{ path: "hosts.alpha.gateways.gateway1.openclaw.token", value: "nope", del: false }],
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("policy")
    }
    expect(mutation).not.toHaveBeenCalled()
  })

  it("rejects openclaw changes via writeClawletsConfigFile", async () => {
    const { mod, mutation } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.writeClawletsConfigFile({
          data: {
            projectId: "p1" as any,
            next: {
              hosts: {
                alpha: { gatewaysOrder: ["gateway1"], gateways: { gateway1: { openclaw: { ok: false } } } },
              },
            },
            title: "Update config",
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("policy")
    }
    expect(mutation).toHaveBeenCalled()
  })
})
