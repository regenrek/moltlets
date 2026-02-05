import { describe, expect, it, vi } from "vitest"

describe("openclaw schema output parsing", () => {
  it("rejects payloads larger than the limit", () => {
    const nonce = "big00001"
    const raw = [
      `__OPENCLAW_SCHEMA_BEGIN__${nonce}__`,
      "a".repeat(2 * 1024 * 1024 + 1),
      `__OPENCLAW_SCHEMA_END__${nonce}__`,
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
      expect(() => __test_extractJsonBlock(raw, nonce)).toThrow("schema payload too large")
    })()
  })

  it("extracts JSON amid banners and noise", () => {
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
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
      const extracted = __test_extractJsonBlock(raw, nonce)
      expect(JSON.parse(extracted)).toMatchObject({ version: "1.0.0" })
    })()
  })

  it("extracts JSON between markers", () => {
    const nonce = "bead1234"
    const raw = [
      "noise line",
      `__OPENCLAW_SCHEMA_BEGIN__${nonce}__`,
      "{\"schema\":{\"type\":\"object\"},\"version\":\"1.1.0\",\"generatedAt\":\"x\",\"openclawRev\":\"rev\"}",
      `__OPENCLAW_SCHEMA_END__${nonce}__`,
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
      const extracted = __test_extractJsonBlock(raw, nonce)
      expect(JSON.parse(extracted)).toMatchObject({ version: "1.1.0" })
    })()
  })

  it("extracts last valid JSON object", () => {
    const nonce = "feedcafe"
    const raw = [
      `__OPENCLAW_SCHEMA_BEGIN__${nonce}__`,
      "{\"schema\":{\"type\":\"object\"},\"version\":\"2.0.0\"}",
      `__OPENCLAW_SCHEMA_END__${nonce}__`,
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
      const extracted = __test_extractJsonBlock(raw, nonce)
      expect(JSON.parse(extracted)).toMatchObject({ version: "2.0.0" })
    })()
  })

  it("rejects nested lookalike without markers", () => {
    const nonce = "c0ffee01"
    const raw = [
      "log line",
      "{\"message\":\"nested {\\\"schema\\\":{\\\"type\\\":\\\"object\\\"},\\\"version\\\":\\\"x\\\",\\\"generatedAt\\\":\\\"x\\\",\\\"openclawRev\\\":\\\"rev\\\"}\"}",
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
      expect(() => __test_extractJsonBlock(raw, nonce)).toThrow("missing schema markers in output")
    })()
  })

  it("ignores marker-like strings embedded in output", () => {
    const nonce = "badc0de1"
    const raw = [
      "noise __OPENCLAW_SCHEMA_BEGIN__badc0de1__ noise",
      "{\"schema\":{\"type\":\"object\"},\"version\":\"3.0.0\"}",
      "noise __OPENCLAW_SCHEMA_END__badc0de1__ noise",
    ].join("\n")
    return (async () => {
      const { __test_extractJsonBlock } = await import("~/server/openclaw-schema.server")
      expect(() => __test_extractJsonBlock(raw, nonce)).toThrow("missing schema markers in output")
    })()
  })

  it("rejects JSON missing schema fields", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce12", "utf8"),
    }))
    const sshCapture = async () =>
      [
        "__OPENCLAW_SCHEMA_BEGIN__6e6f6e63653132__",
        "{\"ok\":true}",
        "__OPENCLAW_SCHEMA_END__6e6f6e63653132__",
      ].join("\n")
    const query = async () => ({ project: { localPath: "/tmp" }, role: "admin" })
    const mutation = async () => null
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawlets/core/lib/clawlets-config", () => ({
      loadClawletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1", gatewaysOrder: ["gateway1"], gateways: { gateway1: {} } } },
        },
      }),
    }))
    vi.doMock("@clawlets/core/lib/openclaw-config-invariants", () => ({
      buildOpenClawGatewayConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toContain("schema payload missing required fields")
    }
  })

  it("rejects non-object schema field", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce34", "utf8"),
    }))
    const sshCapture = async () =>
      [
        "__OPENCLAW_SCHEMA_BEGIN__6e6f6e63653334__",
        "{\"schema\":[],\"version\":\"1\",\"generatedAt\":\"x\",\"openclawRev\":\"rev\"}",
        "__OPENCLAW_SCHEMA_END__6e6f6e63653334__",
      ].join("\n")
    const query = async () => ({ project: { localPath: "/tmp" }, role: "admin" })
    const mutation = async () => null
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawlets/core/lib/clawlets-config", () => ({
      loadClawletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1", gatewaysOrder: ["gateway1"], gateways: { gateway1: {} } } },
        },
      }),
    }))
    vi.doMock("@clawlets/core/lib/openclaw-config-invariants", () => ({
      buildOpenClawGatewayConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toContain("schema payload missing required fields")
    }
  })

  it("rejects non-object uiHints field", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce78", "utf8"),
    }))
    const sshCapture = async () =>
      [
        "__OPENCLAW_SCHEMA_BEGIN__6e6f6e63653738__",
        "{\"schema\":{},\"uiHints\":[],\"version\":\"1\",\"generatedAt\":\"x\",\"openclawRev\":\"rev\"}",
        "__OPENCLAW_SCHEMA_END__6e6f6e63653738__",
      ].join("\n")
    const query = async () => ({ project: { localPath: "/tmp" }, role: "admin" })
    const mutation = async () => null
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawlets/core/lib/clawlets-config", () => ({
      loadClawletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1", gatewaysOrder: ["gateway1"], gateways: { gateway1: {} } } },
        },
      }),
    }))
    vi.doMock("@clawlets/core/lib/openclaw-config-invariants", () => ({
      buildOpenClawGatewayConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toContain("schema payload missing required fields")
    }
  })

  it("quotes gateway id in gateway schema command", async () => {
    vi.resetModules()
    vi.doMock("@clawlets/core/lib/ssh-remote", async () => {
      const actual = await vi.importActual<typeof import("@clawlets/core/lib/ssh-remote")>(
        "@clawlets/core/lib/ssh-remote",
      )
      return actual
    })
    const [{ __test_buildGatewaySchemaCommand }, { shellQuote }] = await Promise.all([
      import("~/server/openclaw-schema.server"),
      import("@clawlets/core/lib/ssh-remote"),
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

  it("escapes gateway id metacharacters in gateway schema command", async () => {
    vi.resetModules()
    vi.doMock("@clawlets/core/lib/ssh-remote", async () => {
      const actual = await vi.importActual<typeof import("@clawlets/core/lib/ssh-remote")>(
        "@clawlets/core/lib/ssh-remote",
      )
      return actual
    })
    const [{ __test_buildGatewaySchemaCommand }, { shellQuote }] = await Promise.all([
      import("~/server/openclaw-schema.server"),
      import("@clawlets/core/lib/ssh-remote"),
    ])
    const gatewayId = "gateway 1;echo pwned"
    const cmd = __test_buildGatewaySchemaCommand({
      gatewayId,
      port: 1234,
      sudo: true,
      nonce: "nonce",
    })
    const envFile = `/srv/openclaw/${gatewayId}/credentials/gateway.env`
    const envFileQuoted = shellQuote(envFile).replace(/'/g, "'\\''")
    expect(cmd).toContain(shellQuote(`gateway-${gatewayId}`))
    expect(cmd).not.toContain(`source ${envFileQuoted}`)
    expect(cmd).toContain("OPENCLAW_GATEWAY_TOKEN")
    expect(cmd).toContain(`env OPENCLAW_GATEWAY_TOKEN="$token"`)
    expect(cmd).not.toContain(`--token "$token"`)
  })

  it("sanitizes raw ssh errors", async () => {
    vi.resetModules()
    vi.doMock("node:crypto", () => ({
      randomBytes: () => Buffer.from("nonce55", "utf8"),
    }))
    const sshCapture = async () => {
      throw new Error(
        "ssh: connect to host 10.0.0.1 port 22: Connection timed out; cmd: bash -lc 'source /srv/openclaw/gateway1/credentials/gateway.env'",
      )
    }
    const query = async () => ({ project: { localPath: "/tmp" }, role: "admin" })
    const mutation = async () => null
    vi.doMock("~/server/convex", () => ({
      createConvexClient: () => ({ query, mutation }) as any,
    }))
    vi.doMock("@clawlets/core/lib/clawlets-config", () => ({
      loadClawletsConfig: () => ({
        config: {
          defaultHost: "h1",
          hosts: { h1: { targetHost: "root@127.0.0.1", gatewaysOrder: ["gateway1"], gateways: { gateway1: {} } } },
        },
      }),
    }))
    vi.doMock("@clawlets/core/lib/openclaw-config-invariants", () => ({
      buildOpenClawGatewayConfig: () => ({
        invariants: { gateway: { port: 18789 } },
      }),
    }))
    vi.doMock("@clawlets/core/lib/ssh-remote", () => ({
      shellQuote: (v: string) => v,
      validateTargetHost: (v: string) => v,
      sshCapture,
    }))
    const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
    const res = await fetchOpenclawSchemaLive({ projectId: "p1" as any, host: "h1", gatewayId: "gateway1" })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toBe("Unable to fetch schema. Check gateway and host settings.")
      expect(res.message).not.toContain("ssh")
      expect(res.message).not.toContain("/srv/openclaw")
    }
  })
})
