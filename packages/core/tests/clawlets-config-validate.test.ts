import { describe, expect, it } from "vitest";

describe("clawlets config validate", () => {
  it("warns on invariant overrides and fails under strict", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 12,
      fleet: {
        botOrder: ["maren"],
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
        bots: {
          maren: {
            clawdbot: {
              commands: { native: "auto", nativeSkills: "auto" },
              gateway: { port: 12345 },
            },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "clawdbot-fleet-host", strict: false });
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes("gateway.port"))).toBe(true);

    const strictRes = validateClawletsConfig({ config: cfg, hostName: "clawdbot-fleet-host", strict: true });
    expect(strictRes.errors.some((e) => e.includes("gateway.port"))).toBe(true);
  });

  it("defaults required clawdbot commands", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 12,
      fleet: {
        botOrder: ["maren"],
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
        bots: {
          maren: {
            clawdbot: {
              channels: { discord: { enabled: true, groupPolicy: "allowlist" } },
            },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "clawdbot-fleet-host", strict: true });
    expect(res.errors).toEqual([]);
  });

  it("fails on inline secrets under strict", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 12,
      fleet: {
        botOrder: ["maren"],
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
        bots: {
          maren: {
            profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" } },
            clawdbot: {
              commands: { native: "auto", nativeSkills: "auto" },
              channels: { discord: { enabled: true, token: "inline-token" } },
            },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "clawdbot-fleet-host", strict: true });
    expect(res.errors.some((e) => e.includes("Inline"))).toBe(true);
  });

  it("warns on secretEnvAllowlist mismatch and fails under strict", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 12,
      fleet: {
        botOrder: ["maren"],
        secretEnv: {},
        bots: {
          maren: {
            profile: {
              secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" },
              secretEnvAllowlist: ["SLACK_BOT_TOKEN"],
            },
            clawdbot: {
              commands: { native: "auto", nativeSkills: "auto" },
              channels: { discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "clawdbot-fleet-host", strict: false });
    expect(res.warnings.some((w) => w.includes("secretEnvAllowlist missing required env vars"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("secretEnvAllowlist contains unused env vars"))).toBe(true);

    const strictRes = validateClawletsConfig({ config: cfg, hostName: "clawdbot-fleet-host", strict: true });
    expect(strictRes.errors.some((e) => e.includes("secretEnvAllowlist missing required env vars"))).toBe(true);
    expect(strictRes.errors.some((e) => e.includes("secretEnvAllowlist contains unused env vars"))).toBe(true);
  });

  it("fails on secretEnv conflicts with derived hooks/skills", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 12,
      fleet: {
        botOrder: ["maren"],
        secretEnv: {},
        bots: {
          maren: {
            profile: {
              secretEnv: { CLAWDBOT_HOOKS_TOKEN: "hooks_token_override" },
              hooks: { tokenSecret: "hooks_token" },
            },
          },
        },
      },
      hosts: {
        "clawdbot-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "openai/gpt-4o" },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "clawdbot-fleet-host", strict: false });
    expect(res.errors.some((e) => e.includes("secretEnv conflicts with derived hooks/skill env vars"))).toBe(true);
  });
});
