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
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { localPath: "/tmp" }, role: "admin" }))
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
  vi.doMock("@clawlets/core/lib/clawlets-config", async () => {
    const actual = await vi.importActual<typeof import("@clawlets/core/lib/clawlets-config")>(
      "@clawlets/core/lib/clawlets-config",
    )
    return {
      ...actual,
      ClawletsConfigSchema: {
        safeParse: (value: unknown) => ({ success: true, data: value }),
      },
      loadClawletsConfig: () => ({
        configPath: "/tmp/fleet/clawlets.json",
        config: { hosts: { alpha: { botsOrder: ["bot1"], bots: { bot1: { openclaw: { ok: true } } } } } },
      }),
      loadClawletsConfigRaw: () => ({
        configPath: "/tmp/fleet/clawlets.json",
        config: { hosts: { alpha: { botsOrder: ["bot1"], bots: { bot1: { openclaw: { ok: true } } } } } },
      }),
      writeClawletsConfig: async () => {},
    }
  })

  const mod = await import("~/sdk/config")
  return { mod, mutation, runWithEvents }
}

describe("config bot openclaw policy", () => {
  it("allows bot channels updates via configDotSet", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotSet({
          data: {
            projectId: "p1" as any,
            path: "hosts.alpha.bots.bot1.channels.discord.enabled",
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
    expect(runWithEvents).toHaveBeenCalled()
  })

  it("allows bot channels updates via configDotBatch", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotBatch({
          data: {
            projectId: "p1" as any,
            ops: [
              {
                path: "hosts.alpha.bots.bot1.channels.discord.enabled",
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
    expect(runWithEvents).toHaveBeenCalled()
  })

  it("allows bot hooks/skills/plugins updates via configDotSet", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const ctx = {
      request: new Request("http://localhost"),
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    }

    const hookRes = await runWithStartContext(ctx, async () =>
      mod.configDotSet({
        data: {
          projectId: "p1" as any,
          path: "hosts.alpha.bots.bot1.hooks.enabled",
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
          path: "hosts.alpha.bots.bot1.skills.allowBundled",
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
          path: "hosts.alpha.bots.bot1.plugins.enabled",
          valueJson: "false",
          value: undefined,
          del: false,
        },
      }),
    )
    expect(pluginRes.ok).toBe(true)

    expect(mutation).toHaveBeenCalled()
    expect(runWithEvents).toHaveBeenCalled()
  })

  it("rejects bot openclaw path updates via configDotSet", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotSet({
          data: {
            projectId: "p1" as any,
            path: "hosts.alpha.bots.bot1.openclaw.token",
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
    expect(runWithEvents).not.toHaveBeenCalled()
  })

  it("rejects bot openclaw path updates via configDotBatch", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotBatch({
          data: {
            projectId: "p1" as any,
            ops: [{ path: "hosts.alpha.bots.bot1.openclaw.token", value: "nope", del: false }],
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("policy")
    }
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
  })

  it("rejects openclaw changes via writeClawletsConfigFile", async () => {
    const { mod, mutation, runWithEvents } = await loadConfig()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.writeClawletsConfigFile({
          data: {
            projectId: "p1" as any,
            next: { hosts: { alpha: { botsOrder: ["bot1"], bots: { bot1: { openclaw: { ok: false } } } } } },
            title: "Update config",
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.code).toBe("policy")
    }
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
  })
})
