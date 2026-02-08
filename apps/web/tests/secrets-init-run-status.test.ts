import { describe, expect, it, vi } from "vitest"
import { AsyncLocalStorage } from "node:async_hooks"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

const startContext = {
  request: new Request("http://localhost"),
  contextAfterGlobalMiddlewares: {},
  executedRequestMiddlewares: new Set(),
}

describe("secrets init execute queueing", () => {
  it("queues secrets init job with local-submit marker", async () => {
    vi.resetModules()
    const mutation = vi.fn(async () => ({ runId: "run1", jobId: "job1" }))
    const query = vi.fn(async () => ({
      role: "admin",
      run: { projectId: "p1", kind: "secrets_init", status: "running" },
    }))

    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ mutation, query }) as any,
    }))

    const mod = await import("~/sdk/secrets")
    const res = await runWithStartContext(startContext, async () =>
      await mod.secretsInitExecute({
        data: {
          projectId: "p1" as any,
          runId: "run1" as any,
          host: "alpha",
          scope: "bootstrap",
          allowPlaceholders: true,
          adminPassword: "pw",
          adminPasswordHash: "",
          tailscaleAuthKey: "",
          secrets: { DISCORD_TOKEN: "secret" },
        },
      }),
    )

    expect(res.ok).toBe(true)
    expect(res.queued).toBe(true)
    expect(res.localSubmitRequired).toBe(true)
    expect(res.jobId).toBe("job1")
    expect(mutation).toHaveBeenCalledTimes(1)
  })
})
