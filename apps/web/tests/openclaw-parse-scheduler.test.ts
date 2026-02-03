import { describe, expect, it, vi, afterEach } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("openclaw parse scheduler", () => {
  it("debounces parsing and linting", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const lintSpy = vi.fn(() => ({
      summary: { critical: 1, warn: 0, info: 0 },
      findings: [{ id: "inlineSecret.gateway.auth.token", severity: "critical", title: "inline", detail: "inline", remediation: "" }],
    }))
    vi.doMock("@clawlets/core/lib/openclaw-security-lint", () => ({
      lintOpenclawSecurityConfig: lintSpy,
    }))
    const mod = await import("~/lib/openclaw-parse")
    let text = "{}"
    const onParsed = vi.fn()
    const onSecurity = vi.fn()
    const scheduler = mod.createOpenclawParseScheduler({
      getText: () => text,
      getGatewayId: () => "bot1",
      onParsed,
      onSecurity,
      delayMs: 200,
      timeoutMs: 500,
    })

    text = "{"
    scheduler.schedule()
    text = "{\"ok\":1}"
    scheduler.schedule()
    text = "{\"gateway\":{\"auth\":{\"token\":\"not-an-env-ref\"}}}"
    scheduler.schedule()

    await vi.runAllTimersAsync()
    expect(onParsed).toHaveBeenCalledTimes(1)
    expect(lintSpy).toHaveBeenCalledTimes(1)
    expect(lintSpy).toHaveBeenCalledWith({ openclaw: { gateway: { auth: { token: "not-an-env-ref" } } }, gatewayId: "bot1" })
    expect(onSecurity).toHaveBeenCalledTimes(1)
    const report = onSecurity.mock.calls[0]?.[0] as any
    expect(report.findings.map((f: any) => f.id)).toContain("inlineSecret.gateway.auth.token")
    scheduler.cancel()
  })
})
