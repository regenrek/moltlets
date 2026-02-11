import { describe, expect, it, vi } from "vitest"

async function loadRepoProbe(params?: {
  values?: Record<string, unknown>
}) {
  vi.resetModules()
  const configDotMultiGet = vi.fn(async () => ({
    values: params?.values ?? {
      hosts: {
        alpha: { targetHost: "admin@203.0.113.4" },
        beta: "ignored",
      },
      "fleet.sshAuthorizedKeys": ["ssh-ed25519 AAAA..."],
    },
  }))
  vi.doMock("~/sdk/config/dot-get", () => ({
    configDotMultiGet,
  }))
  const mod = await import("../src/lib/setup/repo-probe")
  return { mod, configDotMultiGet }
}

describe("repo probe", () => {
  it("loads setup config with one multi-get request", async () => {
    const { mod, configDotMultiGet } = await loadRepoProbe()
    const setup = await mod.loadSetupConfig("p1" as any)

    expect(configDotMultiGet).toHaveBeenCalledTimes(1)
    expect(configDotMultiGet).toHaveBeenCalledWith({
      data: {
        projectId: "p1",
        paths: ["hosts", "fleet.sshAuthorizedKeys"],
      },
    })
    expect(setup.hosts).toEqual({
      alpha: { targetHost: "admin@203.0.113.4" },
    })
    expect(setup.fleet.sshAuthorizedKeys).toEqual(["ssh-ed25519 AAAA..."])
  })

  it("exposes canonical setup probe query key/options", async () => {
    const { mod, configDotMultiGet } = await loadRepoProbe({
      values: {
        hosts: {},
        "fleet.sshAuthorizedKeys": [],
      },
    })

    const key = mod.setupConfigProbeQueryKey("p1" as any)
    expect(key).toEqual(["setupConfigProbe", "p1"])

    const options = mod.setupConfigProbeQueryOptions("p1" as any)
    expect(options.queryKey).toEqual(key)
    expect(options.staleTime).toBe(mod.SETUP_CONFIG_PROBE_STALE_MS)
    expect(options.gcTime).toBe(mod.SETUP_CONFIG_PROBE_GC_MS)
    expect(options.retry).toBe(false)
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.refetchOnReconnect).toBe(false)

    await options.queryFn()
    expect(configDotMultiGet).toHaveBeenCalledTimes(1)
  })

  it("fails fast when probe options queryFn lacks project id", async () => {
    const { mod } = await loadRepoProbe()
    const options = mod.setupConfigProbeQueryOptions(undefined)
    await expect(options.queryFn()).rejects.toThrow(/missing project id/i)
  })
})
