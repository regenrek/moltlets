import { describe, expect, it } from "vitest";

describe("secrets autowire", () => {
  it("plans stable mappings with deterministic ordering", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { planSecretsAutowire } = await import("../src/lib/secrets-autowire");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 1,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "openclaw-fleet-host": {
          gatewaysOrder: ["alpha", "beta"],
          gateways: {
            alpha: {
              channels: { discord: { enabled: true, allowFrom: [], token: "${DISCORD_BOT_TOKEN}" } },
            },
            beta: {
              channels: { telegram: { enabled: true, allowFrom: [], botToken: "${TELEGRAM_BOT_TOKEN}" } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const plan = planSecretsAutowire({ config: cfg, hostName: "openclaw-fleet-host" });
    const summary = plan.updates.map((u) => `${u.envVar}:${u.gatewayId}:${u.scope}:${u.secretName}`);
    expect(summary).toEqual([
      "DISCORD_BOT_TOKEN:alpha:gateway:discord_token_alpha",
      "OPENAI_API_KEY:alpha:fleet:openai_api_key",
      "TELEGRAM_BOT_TOKEN:beta:gateway:telegram_bot_token_beta",
    ]);
  });

  it("no-ops when already wired", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { planSecretsAutowire } = await import("../src/lib/secrets-autowire");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 1,
      fleet: {
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
      },
      hosts: {
        "openclaw-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" } },
              channels: { discord: { enabled: true, allowFrom: [], token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const plan = planSecretsAutowire({ config: cfg, hostName: "openclaw-fleet-host" });
    expect(plan.updates).toEqual([]);
  });
});
