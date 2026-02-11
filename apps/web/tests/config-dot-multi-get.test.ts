import { AsyncLocalStorage } from "node:async_hooks"
import { describe, expect, it, vi } from "vitest"

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context")
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> }
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage()
const startStorage = globalObj[GLOBAL_STORAGE_KEY]
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) =>
  startStorage?.run(context, fn) as Promise<T>

function startContext() {
  return {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  }
}

async function loadDotGetSdk(params?: {
  objectResult?: Record<string, unknown> | null
  blobResult?: Record<string, unknown> | null
}) {
  vi.resetModules()

  const enqueueRunnerCommand = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }))
  const waitForRunTerminal = vi.fn(async () => ({ status: "succeeded" as const, errorMessage: undefined }))
  const listRunMessages = vi.fn(async () => [])
  const takeRunnerCommandResultObject = vi.fn(async () =>
    params && "objectResult" in params
      ? (params.objectResult ?? null)
      : {
        hosts: { alpha: { targetHost: "admin@203.0.113.4" } },
        fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAA..."] },
      })
  const takeRunnerCommandResultBlobObject = vi.fn(async () =>
    params && "blobResult" in params
      ? (params.blobResult ?? null)
      : null)

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({}) as any,
  }))
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess: async () => ({ role: "admin" }),
  }))
  vi.doMock("~/sdk/runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/sdk/runtime")>()
    return {
      ...actual,
      enqueueRunnerCommand,
      waitForRunTerminal,
      listRunMessages,
      takeRunnerCommandResultObject,
      takeRunnerCommandResultBlobObject,
      lastErrorMessage: () => "config read failed",
    }
  })

  const mod = await import("~/sdk/config/dot-get")
  return {
    mod,
    mocks: {
      enqueueRunnerCommand,
      waitForRunTerminal,
      listRunMessages,
      takeRunnerCommandResultObject,
      takeRunnerCommandResultBlobObject,
    },
  }
}

describe("config dot multi-get", () => {
  it("reads multiple paths with one runner command and normalized keys", async () => {
    const { mod, mocks } = await loadDotGetSdk({
      objectResult: {
        hosts: { alpha: { targetHost: "admin@203.0.113.4" } },
        fleet: { sshAuthorizedKeys: ["ssh-ed25519 AAAA..."] },
      },
    })

    const res = await runWithStartContext(startContext(), async () =>
      await mod.configDotMultiGet({
        data: {
          projectId: "p1" as any,
          paths: ["hosts.alpha.targetHost", "fleet.sshAuthorizedKeys", "fleet.missing"],
        },
      }),
    )

    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      runKind: "custom",
      args: ["config", "show", "--pretty", "false"],
    }))
    expect(res.values["hosts.alpha.targetHost"]).toBe("admin@203.0.113.4")
    expect(res.values["fleet.sshAuthorizedKeys"]).toEqual(["ssh-ed25519 AAAA..."])
    expect(res.values["fleet.missing"]).toBeUndefined()
  })

  it("keeps configDotGet contract using narrow config get command", async () => {
    const { mod, mocks } = await loadDotGetSdk({
      objectResult: {
        path: "hosts.alpha.targetHost",
        value: "admin@203.0.113.4",
      },
    })

    const res = await runWithStartContext(startContext(), async () =>
      await mod.configDotGet({
        data: { projectId: "p1" as any, path: "hosts.alpha.targetHost" },
      }),
    )

    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ["config", "get", "--path", "hosts.alpha.targetHost", "--json"],
    }))
    expect(res).toEqual({
      path: "hosts.alpha.targetHost",
      value: "admin@203.0.113.4",
    })
  })

  it("validates paths array shape and limits", async () => {
    const { mod } = await loadDotGetSdk()

    await expect(runWithStartContext(startContext(), async () =>
      await mod.configDotMultiGet({ data: { projectId: "p1" as any, paths: [] } }),
    )).rejects.toThrow(/missing paths/i)

    await expect(runWithStartContext(startContext(), async () =>
      await mod.configDotMultiGet({ data: { projectId: "p1" as any, paths: new Array(101).fill("fleet") } }),
    )).rejects.toThrow(/too many paths/i)

    await expect(runWithStartContext(startContext(), async () =>
      await mod.configDotMultiGet({ data: { projectId: "p1" as any, paths: [""] } }),
    )).rejects.toThrow(/missing path at index 0/i)
  })

  it("fails with clear error when runner returns no JSON payload", async () => {
    const { mod } = await loadDotGetSdk({ objectResult: null, blobResult: null })

    await expect(runWithStartContext(startContext(), async () =>
      await mod.configDotMultiGet({
        data: { projectId: "p1" as any, paths: ["hosts"] },
      }),
    )).rejects.toThrow(/may exceed runner result limits/i)
  })
})
