import { describe, expect, it } from "vitest"

describe("secrets write allowlist", () => {
  it("rejects unmanaged secret names", async () => {
    const { ClawletsConfigSchema, CLAWLETS_CONFIG_SCHEMA_VERSION } = await import("@clawlets/core/lib/clawlets-config")
    const { assertSecretsAreManaged, buildManagedHostSecretNameAllowlist } = await import("../src/sdk/secrets-allowlist")

    const config = ClawletsConfigSchema.parse({
      schemaVersion: CLAWLETS_CONFIG_SCHEMA_VERSION,
      baseFlake: "",
      cattle: {
        enabled: false,
        hetzner: {
          image: "",
          serverType: "cx22",
          location: "nbg1",
          maxInstances: 10,
          defaultTtl: "2h",
          labels: { "managed-by": "clawlets" },
        },
        defaults: { autoShutdown: true, callbackUrl: "" },
      },
      fleet: { secretEnv: {}, secretFiles: {} },
      hosts: { alpha: { botsOrder: [], bots: {}, tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" } },
    })

    const allowlist = buildManagedHostSecretNameAllowlist({ config, host: "alpha" })
    expect(() => assertSecretsAreManaged({ allowlist, secrets: { unmanaged_secret: "value" } })).toThrow(
      /unmanaged secret name/i,
    )
  })

  it("includes required host secrets", async () => {
    const { ClawletsConfigSchema, CLAWLETS_CONFIG_SCHEMA_VERSION } = await import("@clawlets/core/lib/clawlets-config")
    const { buildManagedHostSecretNameAllowlist } = await import("../src/sdk/secrets-allowlist")

    const config = ClawletsConfigSchema.parse({
      schemaVersion: CLAWLETS_CONFIG_SCHEMA_VERSION,
      baseFlake: "",
      cattle: {
        enabled: false,
        hetzner: {
          image: "",
          serverType: "cx22",
          location: "nbg1",
          maxInstances: 10,
          defaultTtl: "2h",
          labels: { "managed-by": "clawlets" },
        },
        defaults: { autoShutdown: true, callbackUrl: "" },
      },
      fleet: {
        secretEnv: {},
        secretFiles: {},
        backups: { restic: { enable: true, repository: "s3://restic" } },
      },
      hosts: {
        alpha: {
          botsOrder: [],
          bots: {},
          tailnet: { mode: "tailscale" },
          cache: { netrc: { enable: true, secretName: "garnix_netrc" } },
        },
      },
    })

    const allowlist = buildManagedHostSecretNameAllowlist({ config, host: " alpha " })
    expect(allowlist.has("admin_password_hash")).toBe(true)
    expect(allowlist.has("tailscale_auth_key")).toBe(true)
    expect(allowlist.has("garnix_netrc")).toBe(true)
    expect(allowlist.has("restic_password")).toBe(true)
  })
})
