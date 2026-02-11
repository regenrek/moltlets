import { describe, expect, it, vi } from "vitest"

const VALID_SCHEMA = {
  schema: { type: "object" },
  uiHints: {},
  version: "1.0.0",
  generatedAt: "x",
  openclawRev: "rev",
}

function mockRunnerSchema(params?: {
  adminDeny?: boolean
  guardError?: Error | null
  terminal?: { status: "succeeded" | "failed" | "canceled"; errorMessage?: string }
  messages?: string[]
  resultJson?: Record<string, unknown>
}) {
  const requireAdminProjectAccess = vi.fn(async () => {
    if (params?.adminDeny) throw new Error("admin required")
    return { role: "admin" }
  })
  const mutation = vi.fn(async () => {
    if (params?.guardError) throw params.guardError
    return null
  })
  const enqueueRunnerCommand = vi.fn(async () => ({ runId: "run-1" as any, jobId: "job-1" as any }))
  const waitForRunTerminal = vi.fn(async () => params?.terminal || ({ status: "succeeded" as const }))
  const listRunMessages = vi.fn(async () => params?.messages || [])
  const takeRunnerCommandResultBlobObject = vi.fn(async () => params?.resultJson || null)
  const takeRunnerCommandResultObject = vi.fn(async () => params?.resultJson || null)
  const lastErrorMessage = vi.fn((_messages: string[], fallback?: string) => fallback || "runner command failed")

  vi.doMock("~/sdk/project", () => ({ requireAdminProjectAccess }))
  vi.doMock("~/server/convex", () => ({ createConvexClient: () => ({ mutation }) as any }))
  vi.doMock("~/sdk/runtime", () => ({
    enqueueRunnerCommand,
    waitForRunTerminal,
    listRunMessages,
    takeRunnerCommandResultBlobObject,
    takeRunnerCommandResultObject,
    lastErrorMessage,
  }))

  return {
    requireAdminProjectAccess,
    mutation,
    enqueueRunnerCommand,
    takeRunnerCommandResultBlobObject,
    takeRunnerCommandResultObject,
  }
}

describe("openclaw schema output parsing", () => {
  it("resolves command-result mode from shared runner policy", async () => {
    vi.resetModules()
    const { __test_resolveStructuredCommandResultMode } = await import("~/server/openclaw-schema.server")
    expect(
      __test_resolveStructuredCommandResultMode([
        "openclaw",
        "schema",
        "fetch",
        "--host",
        "h1",
        "--gateway",
        "g1",
        "--ssh-tty=false",
      ]),
    ).toBe("large")
    expect(__test_resolveStructuredCommandResultMode(["openclaw", "schema", "status", "--json"])).toBe("small")
    expect(__test_resolveStructuredCommandResultMode(["doctor"])).toBeNull()
  })

  it("uses blob take path for live schema fetch", async () => {
    vi.resetModules()
    const mocks = mockRunnerSchema({
      resultJson: VALID_SCHEMA,
    })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const result = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(result.ok).toBe(true)
    expect(mocks.takeRunnerCommandResultBlobObject).toHaveBeenCalledTimes(1)
    expect(mocks.takeRunnerCommandResultObject).toHaveBeenCalledTimes(0)
  })

  it("returns schema parse failures from runner output", async () => {
    vi.resetModules()
    mockRunnerSchema({
      resultJson: { ok: true },
    })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toBe("schema payload missing required fields")
    }
  })

  it("sanitizes raw runner failures", async () => {
    vi.resetModules()
    mockRunnerSchema({
      terminal: {
        status: "failed",
        errorMessage:
          "ssh: connect to host 10.0.0.1 port 22: Connection timed out; cmd: bash -lc 'source /srv/openclaw/gateway1/credentials/gateway.env'",
      },
      messages: [],
    })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toBe("Unable to fetch schema. Check gateway and host settings.")
      expect(res.message).not.toContain("ssh")
      expect(res.message).not.toContain("/srv/openclaw")
    }
  })

  it("rejects non-admin before runner execution", async () => {
    vi.resetModules()
    const mocks = mockRunnerSchema({ adminDeny: true })
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("admin required")
    expect(mocks.mutation).not.toHaveBeenCalled()
    expect(mocks.enqueueRunnerCommand).not.toHaveBeenCalled()
  })
})
