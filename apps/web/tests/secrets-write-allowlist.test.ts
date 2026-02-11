import { describe, expect, it } from "vitest"
import { ClawletsConfigSchema, CLAWLETS_CONFIG_SCHEMA_VERSION } from "@clawlets/core/lib/config/clawlets-config"
import { assertSecretsAreManaged, buildManagedHostSecretNameAllowlist } from "@clawlets/core/lib/secrets/secrets-allowlist"

describe("secrets write allowlist", () => {
  it("rejects unmanaged secret names", async () => {
    const config = ClawletsConfigSchema.parse({
      schemaVersion: CLAWLETS_CONFIG_SCHEMA_VERSION,
      baseFlake: "",
      fleet: { secretEnv: {}, secretFiles: {} },
      hosts: {
        alpha: {
          gatewaysOrder: ["main"],
          gateways: { main: {} },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    })

    const allowlist = buildManagedHostSecretNameAllowlist({ config, host: "alpha" })
    expect(() => assertSecretsAreManaged({ allowlist, secrets: { unmanaged_secret: "value" } })).toThrow(
      /unmanaged secret name/i,
    )
  })

  it("includes required host secrets", async () => {
    const config = ClawletsConfigSchema.parse({
      schemaVersion: CLAWLETS_CONFIG_SCHEMA_VERSION,
      baseFlake: "",
      fleet: {
        secretEnv: {},
        secretFiles: {},
        backups: { restic: { enable: true, repository: "s3://restic" } },
      },
      hosts: {
        alpha: {
          gatewaysOrder: ["main"],
          gateways: { main: {} },
          tailnet: { mode: "tailscale" },
          cache: { netrc: { enable: true, secretName: "garnix_netrc" } },
          agentModelPrimary: "zai/glm-4.7",
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
