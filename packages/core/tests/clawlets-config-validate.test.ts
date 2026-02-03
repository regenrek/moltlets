import { describe, expect, it } from "vitest";

const TEST_TIMEOUT_MS = 15_000;

describe("clawlets config validate", () => {
  it(
    "warns on invariant overrides and fails under strict",
    async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 17,
      fleet: {
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
      },
      hosts: {
        "openclaw-fleet-host": {
          botsOrder: ["maren"],
          bots: {
            maren: {
              openclaw: {
                commands: { native: "auto", nativeSkills: "auto" },
                gateway: { port: 12345 },
              },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "openclaw-fleet-host", strict: false });
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => w.includes("gateway.port"))).toBe(true);

    const strictRes = validateClawletsConfig({ config: cfg, hostName: "openclaw-fleet-host", strict: true });
    expect(strictRes.errors.some((e) => e.includes("gateway.port"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "defaults required clawdbot commands",
    async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 17,
      fleet: {
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
      },
      hosts: {
        "openclaw-fleet-host": {
          botsOrder: ["maren"],
          bots: {
            maren: {
              channels: { discord: { groupPolicy: "allowlist" } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "openclaw-fleet-host", strict: true });
    expect(res.errors).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fails on inline secrets under strict",
    async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 17,
      fleet: {
        secretEnv: { OPENAI_API_KEY: "openai_api_key" },
      },
      hosts: {
        "openclaw-fleet-host": {
          botsOrder: ["maren"],
          bots: {
            maren: {
              profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" } },
              channels: { discord: { groupPolicy: "allowlist", token: "inline-token" } },
              openclaw: {
                commands: { native: "auto", nativeSkills: "auto" },
              },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "openclaw-fleet-host", strict: true });
    expect(res.errors.some((e) => e.includes("Inline"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "warns on secretEnvAllowlist mismatch and fails under strict",
    async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 17,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "openclaw-fleet-host": {
          botsOrder: ["maren"],
          bots: {
            maren: {
              profile: {
                secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" },
                secretEnvAllowlist: ["SLACK_BOT_TOKEN"],
              },
              channels: { discord: { groupPolicy: "allowlist", token: "${DISCORD_BOT_TOKEN}" } },
              openclaw: {
                commands: { native: "auto", nativeSkills: "auto" },
              },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "openclaw-fleet-host", strict: false });
    expect(res.warnings.some((w) => w.includes("secretEnvAllowlist missing required env vars"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("secretEnvAllowlist contains unused env vars"))).toBe(true);

    const strictRes = validateClawletsConfig({ config: cfg, hostName: "openclaw-fleet-host", strict: true });
    expect(strictRes.errors.some((e) => e.includes("secretEnvAllowlist missing required env vars"))).toBe(true);
    expect(strictRes.errors.some((e) => e.includes("secretEnvAllowlist contains unused env vars"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fails on secretEnv conflicts with derived hooks/skills",
    async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { validateClawletsConfig } = await import("../src/lib/clawlets-config-validate");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 17,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "openclaw-fleet-host": {
          botsOrder: ["maren"],
          bots: {
            maren: {
              profile: { secretEnv: { OPENCLAW_HOOKS_TOKEN: "hooks_token_override" } },
              hooks: { tokenSecret: "hooks_token" },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const res = validateClawletsConfig({ config: cfg, hostName: "openclaw-fleet-host", strict: false });
    expect(res.errors.some((e) => e.includes("secretEnv conflicts with derived hooks/skill env vars"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
