import { AsyncLocalStorage } from "node:async_hooks"
import { describe, expect, it, vi } from "vitest"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>

function startContext() {
  return {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  }
}

describe("hosts sdk name generation", () => {
  it("generates host names using current hosts for collision avoidance", async () => {
    vi.resetModules()
    const configDotGet = vi.fn(async ({ data }: { data: { path: string } }) => {
      if (data.path === "hosts") {
        return { path: "hosts", value: { alpha: {}, bravo: {} } }
      }
      return { path: data.path, value: null }
    })
    const generateHostName = vi.fn(() => "brisk-atlas-42")

    vi.doMock("~/sdk/config/dot", () => ({
      configDotGet,
      configDotSet: vi.fn(),
      configDotBatch: vi.fn(),
    }))
    vi.doMock("@clawlets/core/lib/host/host-name-generator", () => ({
      generateHostName,
    }))

    const mod = await import("~/sdk/config/hosts")
    const result = await runWithStartContext(startContext(), async () =>
      await mod.generateHostName({ data: { projectId: "p1" as any } }),
    )

    expect(result).toEqual({ host: "brisk-atlas-42" })
    expect(generateHostName).toHaveBeenCalledWith({ existingHosts: ["alpha", "bravo"] })
  })
})
