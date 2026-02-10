import { describe, expect, it, vi } from "vitest"

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
  const lastErrorMessage = vi.fn((_messages: string[], fallback?: string) => fallback || "runner command failed")

  vi.doMock("~/sdk/project", () => ({ requireAdminProjectAccess }))
  vi.doMock("~/server/convex", () => ({ createConvexClient: () => ({ mutation }) as any }))
  vi.doMock("~/sdk/runtime", () => ({
    enqueueRunnerCommand,
    waitForRunTerminal,
    listRunMessages,
    takeRunnerCommandResultBlobObject,
    lastErrorMessage,
  }))

  return { requireAdminProjectAccess, mutation, enqueueRunnerCommand }
}

describe("openclaw schema output parsing", () => {
  it("rejects payloads larger than the limit", async () => {
    const nonce = "big00001"
    const raw = [
      `__OPENCLAW_SCHEMA_BEGIN__${nonce}__`,
      "a".repeat(6 * 1024 * 1024),
      `__OPENCLAW_SCHEMA_END__${nonce}__`,
    ].join("\n")
    const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
    expect(() => __test_extractJsonBlock(raw, nonce)).toThrow("schema payload too large:")
  }, 15_000)

  it("accepts payloads above 2MB when below transport-aligned cap", async () => {
    const nonce = "mid00001"
    const payload = "a".repeat(3 * 1024 * 1024)
    const raw = [
      `__OPENCLAW_SCHEMA_BEGIN__${nonce}__`,
      payload,
      `__OPENCLAW_SCHEMA_END__${nonce}__`,
    ].join("\n")
    const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
    const extracted = __test_extractJsonBlock(raw, nonce)
    expect(extracted).toHaveLength(payload.length)
  })

  it("extracts JSON amid banners and noise", async () => {
    const nonce = "deadbeef"
    const raw = [
      "Welcome to host",
      "{ not json",
      ">>> banner {with braces}",
      "",
      `__OPENCLAW_SCHEMA_BEGIN__${nonce}__`,
      "{\"schema\":{\"type\":\"object\"},\"version\":\"1.0.0\"}",
      `__OPENCLAW_SCHEMA_END__${nonce}__`,
      "trailing noise {bad}",
    ].join("\n")
    const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
    const extracted = __test_extractJsonBlock(raw, nonce)
    expect(JSON.parse(extracted)).toMatchObject({ version: "1.0.0" })
  })

  it("rejects nested lookalike without markers", async () => {
    const nonce = "c0ffee01"
    const raw = [
      "log line",
      "{\"message\":\"nested {\\\"schema\\\":{\\\"type\\\":\\\"object\\\"},\\\"version\\\":\\\"x\\\",\\\"generatedAt\\\":\\\"x\\\",\\\"openclawRev\\\":\\\"rev\\\"}\"}",
    ].join("\n")
    const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
    expect(() => __test_extractJsonBlock(raw, nonce)).toThrow("missing schema markers in output")
  })

  it("quotes gateway id in gateway schema command", async () => {
    vi.resetModules()
    vi.doMock("@clawlets/core/lib/security/ssh-remote", async () => {
      const actual = await vi.importActual<typeof import("@clawlets/core/lib/security/ssh-remote")>(
        "@clawlets/core/lib/security/ssh-remote",
      )
      return actual
    })
    const [{ __test_buildGatewaySchemaCommand }, { shellQuote }] = await Promise.all([
      import("~/server/openclaw-schema.server"),
      import("@clawlets/core/lib/security/ssh-remote"),
    ])
    const cmd = __test_buildGatewaySchemaCommand({
      gatewayId: "maren-1",
      port: 1234,
      sudo: true,
      nonce: "nonce",
    })
    const envFile = "/srv/openclaw/maren-1/credentials/gateway.env"
    const envFileQuoted = shellQuote(envFile).replace(/'/g, "'\\''")
    expect(cmd).toContain(shellQuote("gateway-maren-1"))
    expect(cmd).not.toContain(`source ${envFileQuoted}`)
    expect(cmd).toContain("OPENCLAW_GATEWAY_TOKEN")
    expect(cmd).toContain(`env OPENCLAW_GATEWAY_TOKEN="$token"`)
    expect(cmd).not.toContain(`--token "$token"`)
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
