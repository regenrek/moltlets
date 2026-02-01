import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

describe("config migrate", () => {
  it("succeeds even if audit log append fails", async () => {
    vi.resetModules()
    const runWithEvents = vi.fn(async ({ fn }: { fn: (emit: (e: any) => Promise<void>) => Promise<void> }) => {
      await fn(async () => {})
    })
    const mutation = vi.fn(async (_mutation: unknown, payload?: { kind?: string; action?: string; status?: string; events?: any[] }) => {
      if (payload?.kind) return { runId: "run1" }
      if (payload?.action === "config.migrate") throw new Error("audit down")
      return null
    })
    const query = vi.fn(async () => ({ role: "admin" }))

    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))
    vi.doMock("~/server/redaction", () => ({ readClawletsEnvTokens: async () => [] }))
    vi.doMock("~/server/run-manager", () => ({ runWithEvents }))
    vi.doMock("~/sdk/repo-root", () => ({ getRepoRoot: async () => "/tmp/repo" }))
    vi.doMock("@clawlets/core/repo-layout", () => ({
      getRepoLayout: () => ({ clawletsConfigPath: "/tmp/repo/fleet/clawlets.json" }),
    }))
    vi.doMock("node:fs/promises", () => ({ readFile: async () => "{}" }))
    vi.doMock("@clawlets/core/lib/clawlets-config", async () => {
      const actual = await vi.importActual<typeof import("@clawlets/core/lib/clawlets-config")>(
        "@clawlets/core/lib/clawlets-config",
      )
      return {
        ...actual,
        ClawletsConfigSchema: {
          safeParse: (value: unknown) => ({ success: true, data: value }),
        },
        writeClawletsConfig: async () => {},
      }
    })
    vi.doMock("@clawlets/core/lib/clawlets-config-migrate", () => ({
      migrateClawletsConfigToV12: () => ({ changed: true, migrated: { schemaVersion: 12 }, warnings: [] }),
    }))

    const mod = await import("~/sdk/config-migrate")
    const res = await runWithStartContext(
      { request: new Request("http://localhost"), contextAfterGlobalMiddlewares: {}, executedRequestMiddlewares: new Set() },
      async () => await mod.migrateClawletsConfigFileToV12({ data: { projectId: "p1" as any } }),
    )

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error("expected ok")
    expect(res.changed).toBe(true)

    const statusCalls = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => payload?.status)
      .map((payload) => payload?.status)
    expect(statusCalls).toContain("succeeded")
    expect(statusCalls).not.toContain("failed")

    const warnEvents = mutation.mock.calls
      .map(([, payload]) => payload)
      .filter((payload) => Array.isArray(payload?.events))
      .flatMap((payload) => payload?.events ?? [])
      .filter((event: { level?: string }) => event?.level === "warn")
    expect(warnEvents).toHaveLength(1)
    expect(warnEvents[0]?.message).toMatch(/post-run cleanup failed/i)
  })
})
