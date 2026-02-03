import { describe, expect, it } from "vitest";

describe("secrets init template sets", () => {
  it("marks garnix netrc secret as netrc placeholder", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");
    const { buildSecretsInitTemplateSets } = await import("../src/lib/secrets-init-template");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 16,
      fleet: {
        gatewayOrder: ["alpha"],
        secretEnv: {},
        gateways: { alpha: {} },
      },
      hosts: {
        "openclaw-fleet-host": {
          tailnet: { mode: "tailscale" },
          cache: { netrc: { enable: true, secretName: "garnix_netrc" } },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const secretsPlan = buildFleetSecretsPlan({ config: cfg, hostName: "openclaw-fleet-host" });
    const hostCfg = cfg.hosts["openclaw-fleet-host"];
    const sets = buildSecretsInitTemplateSets({ secretsPlan, hostCfg });

    expect(sets.requiresTailscaleAuthKey).toBe(true);
    expect(sets.templateSecrets["garnix_netrc"]).toBe("<REPLACE_WITH_NETRC>");
    expect(sets.requiredSecrets).toContain("garnix_netrc");
    expect(sets.requiredSecrets).not.toContain("admin_password_hash");
    expect(sets.requiredSecrets).not.toContain("tailscale_auth_key");
    expect(sets.requiredSecretNames).toEqual(
      expect.arrayContaining(["admin_password_hash", "tailscale_auth_key", "garnix_netrc"]),
    );
  });

  it("omits garnix netrc placeholder when private cache disabled", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");
    const { buildSecretsInitTemplateSets } = await import("../src/lib/secrets-init-template");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 16,
      fleet: {
        gatewayOrder: ["alpha"],
        secretEnv: {},
        gateways: { alpha: {} },
      },
      hosts: {
        "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const secretsPlan = buildFleetSecretsPlan({ config: cfg, hostName: "openclaw-fleet-host" });
    const hostCfg = cfg.hosts["openclaw-fleet-host"];
    const sets = buildSecretsInitTemplateSets({ secretsPlan, hostCfg });

    expect(sets.requiresTailscaleAuthKey).toBe(false);
    expect(sets.templateSecrets["garnix_netrc"]).toBeUndefined();
  });
});
