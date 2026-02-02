import { describe, expect, it } from "vitest";

describe("secrets autowire", () => {
  it("plans stable mappings with deterministic ordering", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { planSecretsAutowire } = await import("../src/lib/secrets-autowire");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 15,
      fleet: {
        botOrder: ["alpha", "beta"],
        secretEnv: {},
        bots: {
          alpha: {
            channels: { discord: { enabled: true, allowFrom: [], token: "${DISCORD_BOT_TOKEN}" } },
          },
          beta: {
            channels: { telegram: { enabled: true, allowFrom: [], botToken: "${TELEGRAM_BOT_TOKEN}" } },
          },
        },
      },
      hosts: {
        "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const plan = planSecretsAutowire({ config: cfg, hostName: "openclaw-fleet-host" });
    const summary = plan.updates.map((u) => `${u.envVar}:${u.bot}:${u.scope}:${u.secretName}`);
    expect(summary).toEqual([
      "DISCORD_BOT_TOKEN:alpha:bot:discord_token_alpha",
      "OPENAI_API_KEY:alpha:fleet:openai_api_key",
      "TELEGRAM_BOT_TOKEN:beta:bot:telegram_bot_token_beta",
    ]);
  });

  it("no-ops when already wired", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { planSecretsAutowire } = await import("../src/lib/secrets-autowire");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 15,
      fleet: {
        botOrder: ["maren"],
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
        bots: {
          maren: {
            profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" } },
            channels: { discord: { enabled: true, allowFrom: [], token: "${DISCORD_BOT_TOKEN}" } },
          },
        },
      },
      hosts: {
        "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const plan = planSecretsAutowire({ config: cfg, hostName: "openclaw-fleet-host" });
    expect(plan.updates).toEqual([]);
  });
});
