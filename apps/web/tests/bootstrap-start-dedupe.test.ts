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

describe("bootstrapStart dedupe", () => {
  it("reuses active bootstrap run for host", async () => {
    vi.resetModules()
    const query = vi.fn(
      async (_query: unknown, _args: { projectId: string; host: string; kind: string }): Promise<{
        _id: string
        status: string
      }> => ({ _id: "run_existing", status: "running" }),
    )
    const mutation = vi.fn(
      async (
        _mutation: unknown,
        _args: { runId: string } | { projectId: string; kind: string; title: string; host: string },
      ): Promise<{ runId: string } | null> => ({ runId: "run_new" }),
    )
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))

    const { bootstrapStart } = await import("~/sdk/infra")

    const res = await runWithStartContext(startContext(), async () =>
      await bootstrapStart({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          mode: "nixos-anywhere",
        },
      }),
    )

    expect(res).toEqual({ runId: "run_existing", reused: true })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[1]).toEqual({
      projectId: "p1",
      host: "alpha",
      kind: "bootstrap",
    })
    expect(mutation).not.toHaveBeenCalled()
  })

  it("creates bootstrap run when latest run is terminal", async () => {
    vi.resetModules()
    const query = vi.fn(async (_query: unknown, _args: { projectId: string; host: string; kind: string }): Promise<{
      _id: string
      status: string
    }> => ({ _id: "run_old", status: "failed" }))
    const mutation = vi
      .fn(async (_mutation: unknown, _args: { runId: string } | { projectId: string; action: string; target: { host: string; mode: string }; data: { runId: string } }): Promise<
        { runId: string } | null
      >(() => ({ runId: "run_new" }))
      .mockResolvedValueOnce({ runId: "run_new" })
      .mockResolvedValueOnce(null)
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))

    const { bootstrapStart } = await import("~/sdk/infra")

    const res = await runWithStartContext(startContext(), async () =>
      await bootstrapStart({
        data: {
          projectId: "p1" as any,
          host: "alpha",
          mode: "nixos-anywhere",
        },
      }),
    )

    expect(res).toEqual({ runId: "run_new", reused: false })
    expect(mutation).toHaveBeenCalledTimes(2)
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      projectId: "p1",
      kind: "bootstrap",
      host: "alpha",
      title: "Bootstrap (alpha)",
    })
    expect(mutation.mock.calls[1]?.[1]).toMatchObject({
      projectId: "p1",
      action: "bootstrap",
      target: { host: "alpha", mode: "nixos-anywhere" },
      data: { runId: "run_new" },
    })
  })
})
