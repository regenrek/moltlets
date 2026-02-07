import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

async function loadConfigForWrite() {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; status?: string; errorMessage?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { executionMode: "local", localPath: "/tmp" }, role: "admin" }))
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
  vi.doMock("@clawlets/core/lib/config/clawlets-config", async () => {
    const actual = await vi.importActual<typeof import("@clawlets/core/lib/config/clawlets-config")>(
      "@clawlets/core/lib/config/clawlets-config",
    )
    return {
      ...actual,
      ClawletsConfigSchema: {
        safeParse: (value: unknown) => ({ success: true, data: value }),
      },
      loadFullConfig: () => ({ infraConfigPath: "/tmp/fleet/clawlets.json", config: {} }),
      writeClawletsConfig: async () => {
        throw new Error("permission denied: /etc/hosts")
      },
    }
  })

  const mod = await import("~/sdk/config")
  return { mod, mutation, runWithEvents }
}

async function loadConfigForValidation() {
  vi.resetModules()
  const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; status?: string; errorMessage?: string }) => {
    if (payload?.kind) return { runId: "run1" }
    return null
  })
  const query = vi.fn(async () => ({ project: { executionMode: "local", localPath: "/tmp" }, role: "admin" }))
  const runWithEvents = vi.fn(async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
    await fn(async () => {})
  })
  const writeClawletsConfig = vi.fn(async () => {})

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }))
  vi.doMock("~/server/redaction", () => ({ readClawletsEnvTokens: async () => [] }))
  vi.doMock("~/server/run-manager", () => ({
    runWithEvents,
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
      loadFullConfig: () => ({ infraConfigPath: "/tmp/fleet/clawlets.json", config: {} }),
      writeClawletsConfig,
    }
  })

  const mod = await import("~/sdk/config")
  return { mod, mutation, runWithEvents, writeClawletsConfig }
}

describe("config write failures", () => {
  it("writeClawletsConfigFile returns ok:false and marks run failed", async () => {
    const { mod, mutation, runWithEvents } = await loadConfigForWrite()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.writeClawletsConfigFile({
          data: { projectId: "p1" as any, next: {}, title: "write config" },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.message).toBe("run failed")
    }
    expect(runWithEvents).toHaveBeenCalled()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
    expect(statusCalls[0]?.errorMessage).toBe("run failed")
  })

  it("configDotSet returns ok:false and marks run failed", async () => {
    const { mod, mutation, runWithEvents } = await loadConfigForWrite()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotSet({
          data: {
            projectId: "p1" as any,
            path: "fleet.codex.enable",
            value: "true",
            valueJson: undefined,
            del: false,
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.message).toBe("run failed")
    }
    expect(runWithEvents).toHaveBeenCalled()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
    expect(statusCalls[0]?.errorMessage).toBe("run failed")
  })

  it("configDotBatch returns ok:false and marks run failed", async () => {
    const { mod, mutation, runWithEvents } = await loadConfigForWrite()
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () =>
        await mod.configDotBatch({
          data: {
            projectId: "p1" as any,
            ops: [{ path: "fleet.codex.enable", valueJson: "true", del: false }],
          },
        }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues[0]?.message).toBe("run failed")
    }
    expect(runWithEvents).toHaveBeenCalled()
    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status === "failed")
    expect(statusCalls).toHaveLength(1)
    expect(statusCalls[0]?.errorMessage).toBe("run failed")
  })

  it("configDotBatch rejects ambiguous ops before writing", async () => {
    const { mod, mutation, runWithEvents, writeClawletsConfig } = await loadConfigForValidation()
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.configDotBatch({
            data: {
              projectId: "p1" as any,
              ops: [{ path: "fleet.codex.enable", value: "true", valueJson: "true", del: false }],
            },
          }),
      ),
    ).rejects.toThrow(/ambiguous op/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    expect(writeClawletsConfig).not.toHaveBeenCalled()
  })

  it("configDotSet rejects ambiguous inputs before writing", async () => {
    const { mod, mutation, runWithEvents, writeClawletsConfig } = await loadConfigForValidation()
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.configDotSet({
            data: {
              projectId: "p1" as any,
              path: "fleet.codex.enable",
              value: "true",
              valueJson: "true",
              del: false,
            },
          }),
      ),
    ).rejects.toThrow(/ambiguous value/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    expect(writeClawletsConfig).not.toHaveBeenCalled()
  })

  it("configDotSet rejects del=true with values before writing", async () => {
    const { mod, mutation, runWithEvents, writeClawletsConfig } = await loadConfigForValidation()
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.configDotSet({
            data: {
              projectId: "p1" as any,
              path: "fleet.codex.enable",
              valueJson: "true",
              del: true,
            },
          }),
      ),
    ).rejects.toThrow(/del=true cannot include value/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    expect(writeClawletsConfig).not.toHaveBeenCalled()
  })

  it("configDotBatch aborts when any op is invalid", async () => {
    const { mod, mutation, runWithEvents, writeClawletsConfig } = await loadConfigForValidation()
    await expect(
      runWithStartContext(
        { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
        async () =>
          await mod.configDotBatch({
            data: {
              projectId: "p1" as any,
              ops: [
                { path: "fleet.codex.enable", valueJson: "true", del: false },
                { path: "fleet.codex.gateways", valueJson: "{", del: false },
              ],
            },
          }),
      ),
    ).rejects.toThrow(/invalid JSON value/i)
    expect(mutation).not.toHaveBeenCalled()
    expect(runWithEvents).not.toHaveBeenCalled()
    expect(writeClawletsConfig).not.toHaveBeenCalled()
  })
})
