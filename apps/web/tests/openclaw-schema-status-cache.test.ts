import { describe, expect, it, vi } from "vitest"

function setupStatusMocks(params?: {
  adminMode?: "allow" | "deny"
  delayedTerminalMs?: number
  byProjectMessage?: (projectId: string) => Record<string, unknown>
  terminal?: { status: "succeeded" | "failed" | "canceled"; errorMessage?: string }
}) {
  let currentProjectId = ""
  const requireAdminProjectAccess = vi.fn(async (_client: unknown, projectId: string) => {
    currentProjectId = projectId
    if (params?.adminMode === "deny") throw new Error("admin required")
    return { role: "admin" }
  })

  const mutation = vi.fn(async () => null)
  const enqueueRunnerCommand = vi.fn(async () => ({ runId: "run-status" as any, jobId: "job-status" as any }))
  const waitForRunTerminal = vi.fn(async () => {
    if (params?.delayedTerminalMs) {
      await new Promise((resolve) => setTimeout(resolve, params.delayedTerminalMs))
    }
    return params?.terminal || ({ status: "succeeded" as const })
  })
  const listRunMessages = vi.fn(async () => {
    const payload = params?.byProjectMessage
      ? params.byProjectMessage(currentProjectId)
      : {
          ok: true,
          pinned: { nixOpenclawRev: "pin-default", openclawRev: "openclaw-pin" },
          upstream: { nixOpenclawRef: "main", openclawRev: "openclaw-main" },
        }
    return [JSON.stringify(payload)]
  })
  const parseLastJsonMessage = vi.fn((messages: string[]) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const raw = String(messages[i] || "").trim()
      if (!raw.startsWith("{") || !raw.endsWith("}")) continue
      try {
        return JSON.parse(raw)
      } catch {
        continue
      }
    }
    return null
  })
  const takeRunnerCommandResultObject = vi.fn(
    async (args?: { projectId?: string }): Promise<Record<string, unknown> | null> => {
      const projectId = String(args?.projectId || currentProjectId)
      return params?.byProjectMessage
        ? params.byProjectMessage(projectId)
        : {
            ok: true,
            pinned: { nixOpenclawRev: "pin-default", openclawRev: "openclaw-pin" },
            upstream: { nixOpenclawRef: "main", openclawRev: "openclaw-main" },
          }
    },
  )
  const takeRunnerCommandResultBlobObject = vi.fn(async () => null)
  const lastErrorMessage = vi.fn((_messages: string[], fallback?: string) => fallback || "runner command failed")

  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation }) as any,
  }))
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess,
  }))
  vi.doMock("~/sdk/runtime", () => ({
    enqueueRunnerCommand,
    waitForRunTerminal,
    listRunMessages,
    parseLastJsonMessage,
    takeRunnerCommandResultObject,
    takeRunnerCommandResultBlobObject,
    lastErrorMessage,
  }))

  return {
    requireAdminProjectAccess,
    mutation,
    enqueueRunnerCommand,
    waitForRunTerminal,
    listRunMessages,
    takeRunnerCommandResultObject,
    takeRunnerCommandResultBlobObject,
  }
}

describe("openclaw schema status cache", () => {
  it("reuses cached result within TTL", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const mocks = setupStatusMocks()
    const { fetchOpenclawSchemaStatus } = await import("~/server/openclaw-schema.server")

    const first = await fetchOpenclawSchemaStatus({ projectId: "p1" as any })
    const second = await fetchOpenclawSchemaStatus({ projectId: "p1" as any })

    expect(first).toEqual(second)
    expect(mocks.requireAdminProjectAccess).toHaveBeenCalledTimes(2)
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    expect(mocks.takeRunnerCommandResultObject).toHaveBeenCalledTimes(1)
    expect(mocks.takeRunnerCommandResultBlobObject).toHaveBeenCalledTimes(0)
    vi.useRealTimers()
  })

  it("isolates cache per project", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const mocks = setupStatusMocks({
      byProjectMessage: (projectId) =>
        projectId === "p1"
          ? {
              ok: true,
              pinned: { nixOpenclawRev: "pin-a", openclawRev: "openclaw-a" },
              upstream: { nixOpenclawRef: "main", openclawRev: "openclaw-main-a" },
            }
          : {
              ok: true,
              pinned: { nixOpenclawRev: "pin-b", openclawRev: "openclaw-b" },
              upstream: { nixOpenclawRef: "main", openclawRev: "openclaw-main-b" },
            },
    })
    const { fetchOpenclawSchemaStatus } = await import("~/server/openclaw-schema.server")

    const first = await fetchOpenclawSchemaStatus({ projectId: "p1" as any })
    const second = await fetchOpenclawSchemaStatus({ projectId: "p2" as any })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.pinned?.nixOpenclawRev).not.toBe(second.pinned?.nixOpenclawRev)
    }
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it("caches failures briefly", async () => {
    vi.resetModules()
    const mocks = setupStatusMocks({
      terminal: { status: "failed", errorMessage: "runner failed" },
    })
    const { fetchOpenclawSchemaStatus } = await import("~/server/openclaw-schema.server")

    const first = await fetchOpenclawSchemaStatus({ projectId: "p1" as any })
    const second = await fetchOpenclawSchemaStatus({ projectId: "p1" as any })
    expect(first.ok).toBe(false)
    expect(second).toEqual(first)
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
  })

  it("fails closed when command result is missing and does not fall back to run messages", async () => {
    vi.resetModules()
    const mocks = setupStatusMocks()
    mocks.takeRunnerCommandResultObject.mockResolvedValueOnce(null)
    const { fetchOpenclawSchemaStatus } = await import("~/server/openclaw-schema.server")

    const result = await fetchOpenclawSchemaStatus({ projectId: "p1" as any })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe("Unable to fetch schema status. Check logs.")
    expect(mocks.takeRunnerCommandResultObject).toHaveBeenCalledTimes(1)
    expect(mocks.listRunMessages).toHaveBeenCalledTimes(0)
  })

  it("dedupes in-flight status fetches for same project", async () => {
    vi.resetModules()
    const gate = (() => {
      let release = () => {}
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      return { wait, release }
    })()
    const mocks = setupStatusMocks()
    mocks.waitForRunTerminal.mockImplementationOnce(async () => {
      await gate.wait
      return { status: "succeeded" as const }
    })

    const { fetchOpenclawSchemaStatus } = await import("~/server/openclaw-schema.server")
    const firstPromise = fetchOpenclawSchemaStatus({ projectId: "p1" as any })
    const secondPromise = fetchOpenclawSchemaStatus({ projectId: "p1" as any })
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    gate.release()
    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
  })
})
