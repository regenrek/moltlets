import { describe, expect, it, vi } from "vitest"

const VALID_SCHEMA = {
  schema: { type: "object" },
  uiHints: {},
  version: "1.0.0",
  generatedAt: "x",
  openclawRev: "rev",
}

function setupLiveMocks(params?: {
  adminMode?: "always" | "once-then-deny" | "deny"
  guardError?: Error | null
  terminal?: { status: "succeeded" | "failed" | "canceled"; errorMessage?: string }
  messages?: string[]
  delayedTerminalMs?: number
}) {
  const mutation = vi.fn(async () => {
    if (params?.guardError) throw params.guardError
    return null
  })

  let adminCalls = 0
  const requireAdminProjectAccess = vi.fn(async () => {
    adminCalls += 1
    if (params?.adminMode === "deny") throw new Error("admin required")
    if (params?.adminMode === "once-then-deny" && adminCalls > 1) throw new Error("admin required")
    return { role: "admin" }
  })

  const enqueueRunnerCommand = vi.fn(async () => ({ runId: "run-1" as any, jobId: "job-1" as any }))
  const waitForRunTerminal = vi.fn(async () => {
    if (params?.delayedTerminalMs) {
      await new Promise((resolve) => setTimeout(resolve, params.delayedTerminalMs))
    }
    return params?.terminal || ({ status: "succeeded" } as const)
  })
  const listRunMessages = vi.fn(async () => params?.messages || [JSON.stringify(VALID_SCHEMA)])
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
    lastErrorMessage,
  }))

  return {
    mutation,
    requireAdminProjectAccess,
    enqueueRunnerCommand,
    waitForRunTerminal,
    listRunMessages,
  }
}

describe("openclaw live schema cache", () => {
  it("caches live schema per host/gateway", async () => {
    vi.resetModules()
    const mocks = setupLiveMocks()
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")

    const first = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    const second = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    expect(mocks.requireAdminProjectAccess).toHaveBeenCalledTimes(2)
    expect(mocks.mutation).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    expect(mocks.waitForRunTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.listRunMessages).toHaveBeenCalledTimes(1)
  })

  it("dedupes in-flight live schema fetches", async () => {
    vi.resetModules()
    const gate = (() => {
      let release = () => {}
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      return { wait, release }
    })()
    const mocks = setupLiveMocks({ delayedTerminalMs: 0 })
    mocks.waitForRunTerminal.mockImplementationOnce(async () => {
      await gate.wait
      return { status: "succeeded" as const }
    })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")

    const firstPromise = fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    const secondPromise = fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    await new Promise((resolve) => setImmediate(resolve))
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    gate.release()
    const [first, second] = await Promise.all([firstPromise, secondPromise])
    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
  })

  it("anchors TTL to completion time", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.resetModules()
    const mocks = setupLiveMocks({ delayedTerminalMs: 5_000 })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")

    const firstPromise = fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    await vi.advanceTimersByTimeAsync(5_000)
    const first = await firstPromise
    await vi.advanceTimersByTimeAsync(14_999)
    const second = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })

    expect(first).toEqual(second)
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("does not leak cached schema across roles", async () => {
    vi.resetModules()
    const mocks = setupLiveMocks({ adminMode: "once-then-deny" })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")

    const adminResult = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    const viewerResult = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })

    expect(adminResult.ok).toBe(true)
    expect(viewerResult.ok).toBe(false)
    if (!viewerResult.ok) expect(viewerResult.message).toBe("admin required")
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
  })

  it("rejects non-admin before runner execution", async () => {
    vi.resetModules()
    const mocks = setupLiveMocks({ adminMode: "deny" })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")

    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("admin required")
    expect(mocks.mutation).not.toHaveBeenCalled()
    expect(mocks.enqueueRunnerCommand).not.toHaveBeenCalled()
  })

  it("rate-limit blocks runner execution", async () => {
    vi.resetModules()
    const rateError: any = new Error("ConvexError")
    rateError.data = { code: "rate_limited", message: "too many requests" }
    const mocks = setupLiveMocks({ guardError: rateError })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")

    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("too many requests")
    expect(mocks.enqueueRunnerCommand).not.toHaveBeenCalled()
  })

  it("caches failures briefly to avoid retries", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const mocks = setupLiveMocks({
      terminal: { status: "failed", errorMessage: "runner failed" },
      messages: [],
    })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")

    const first = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })
    const second = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "bot1" })

    expect(first).toEqual(second)
    expect(first.ok).toBe(false)
    expect(mocks.enqueueRunnerCommand).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
