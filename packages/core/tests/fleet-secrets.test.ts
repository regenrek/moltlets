import { describe, it, expect } from "vitest";

describe("fleet secrets plan", () => {
  it("collects required secrets for zai/* models", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: { maren: {} },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesAll).toEqual(["z_ai_api_key"]);
    expect(plan.secretNamesRequired).toEqual(["z_ai_api_key"]);
    const requiredNames = plan.required.map((spec) => spec.name);
    expect(requiredNames).toContain("z_ai_api_key");
    expect(requiredNames).toContain("admin_password_hash");
  });

  it("flags missing secretEnv mapping for openai/* models", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: { maren: {} },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai/gpt-4o",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(true);
  });

  it("accepts legacy Z_AI_API_KEY mappings for zai/*", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { Z_AI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: { maren: {} },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesRequired).toContain("z_ai_api_key");
  });

  it("does not require secretEnv mapping for OAuth providers", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: { maren: {} },
          tailnet: { mode: "none" },
          agentModelPrimary: "openai-codex/gpt-5",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(false);
    expect(plan.warnings.some((w) => w.kind === "auth" && w.provider === "openai-codex")).toBe(true);
  });

  it("warns on inline channel tokens with suggested env wiring", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              channels: { discord: { enabled: true, allowFrom: [], token: "inline-token" } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    const warning = plan.warnings.find((w) => w.kind === "inlineToken");
    expect(warning?.message).toMatch(/Inline discord token/i);
    expect(warning?.suggestion).toMatch(/DISCORD_BOT_TOKEN/);
  });

  it("includes hook + skill secret mappings from gateway config", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              hooks: { tokenSecret: "hooks_token" },
              skills: { entries: { "brave-search": { apiKeySecret: "brave_api_key" } } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesRequired).toEqual(expect.arrayContaining(["hooks_token", "brave_api_key"]));
    expect(plan.byGateway.maren.envVarsRequired).toEqual(
      expect.arrayContaining(["OPENCLAW_HOOKS_TOKEN", "OPENCLAW_SKILL_BRAVE_SEARCH_API_KEY"]),
    );
  });

  it("warns on inline hooks + skill apiKey values", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              hooks: { token: "inline-hook-token" },
              skills: { entries: { "brave-search": { apiKey: "inline-skill-key" } } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.warnings.some((w) => w.kind === "inlineToken" && w.path === "hooks.token")).toBe(true);
    expect(plan.warnings.some((w) => w.kind === "inlineApiKey" && w.path === "skills.entries.brave-search.apiKey")).toBe(true);
  });

  it("includes per-gateway secretEnv overrides for mixed providers", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["alpha", "beta"],
          gateways: {
            alpha: {
              profile: {
                secretEnv: { ANTHROPIC_API_KEY: "anthropic_api_key" },
              },
              agents: { defaults: { model: { primary: "anthropic/claude-3-5-sonnet" } } },
            },
            beta: {},
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing).toEqual([]);
    expect(plan.secretNamesRequired).toEqual(["anthropic_api_key", "z_ai_api_key"]);
  });

  it("requires DISCORD_BOT_TOKEN mapping when referenced", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_maren" } },
              channels: { discord: { enabled: true, allowFrom: [], token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.secretNamesRequired).toContain("discord_token_maren");
  });

  it("flags missing DISCORD_BOT_TOKEN mapping when referenced", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              channels: { discord: { enabled: true, allowFrom: [], token: "${DISCORD_BOT_TOKEN}" } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.gateway === "maren" && m.envVar === "DISCORD_BOT_TOKEN")).toBe(true);
  });

  it("rejects host secretFiles targetPath outside /var/lib/clawlets", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");

    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 18,
        fleet: {
          secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
          secretFiles: {
            netrc: { secretName: "garnix_netrc", targetPath: "/srv/clawdbot/maren/credentials/netrc", mode: "0400" },
          },
        },
        hosts: {
          "clawdbot-fleet-host": {
            gatewaysOrder: ["maren"],
            gateways: { maren: {} },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/targetPath must be under/i);
  });

  it("flags host secretFiles targetPath traversal", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");

    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 18,
        fleet: {
          secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
          secretFiles: {
            netrc: { secretName: "garnix_netrc", targetPath: "/var/lib/clawlets/../etc/shadow", mode: "0400" },
          },
        },
        hosts: {
          "clawdbot-fleet-host": {
            gatewaysOrder: ["maren"],
            gateways: { maren: {} },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/must not contain/i);
  });

  it("flags invalid per-gateway secretFiles targetPath", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              profile: {
                secretEnv: {},
                secretFiles: {
                  creds: {
                    secretName: "discord_token_maren",
                    targetPath: "/var/lib/clawlets/secrets/discord_token_maren",
                    mode: "0400",
                  },
                },
              },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "secretFile" && m.scope === "gateway" && m.gateway === "maren" && m.fileId === "creds")).toBe(true);
  });

  it("flags per-gateway secretFiles targetPath traversal", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");

    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 18,
        fleet: {
          secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
        },
        hosts: {
          "clawdbot-fleet-host": {
            gatewaysOrder: ["maren"],
            gateways: {
              maren: {
                profile: {
                  secretEnv: {},
                  secretFiles: {
                    creds: {
                      secretName: "discord_token_maren",
                      targetPath: "/var/lib/clawlets/secrets/gateways/maren/../etc/shadow",
                      mode: "0400",
                    },
                  },
                },
              },
            },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/must not contain/i);
  });

  it("does not mark whatsapp as stateful when explicitly disabled", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              channels: { whatsapp: { enabled: false } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.byGateway.maren.statefulChannels).toEqual([]);
  });

  it("includes env vars from models.providers", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              openclaw: {
                models: {
                  providers: {
                    moonshot: {
                      apiKey: "${MOONSHOT_API_KEY}",
                      baseUrl: "https://api.moonshot.example",
                      models: [{ id: "moonshot-v1", name: "moonshot-v1" }],
                    },
                  },
                },
              },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "MOONSHOT_API_KEY")).toBe(true);
  });

  it("includes fallback model provider keys", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              agents: { defaults: { model: { primary: "openai/gpt-4o", fallbacks: ["anthropic/claude-3-5-sonnet"] } } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "OPENAI_API_KEY")).toBe(true);
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "ANTHROPIC_API_KEY")).toBe(false);
    expect(plan.warnings.some((w) => w.kind === "auth" && w.provider === "anthropic")).toBe(true);
  });

  it("warns on inline discord token", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const { buildFleetSecretsPlan } = await import("../src/lib/fleet-secrets-plan");

    const cfg = ClawletsConfigSchema.parse({
      schemaVersion: 18,
      fleet: {
        secretEnv: {},
      },
      hosts: {
        "clawdbot-fleet-host": {
          gatewaysOrder: ["maren"],
          gateways: {
            maren: {
              channels: { discord: { enabled: true, allowFrom: [], token: "inline-token" } },
            },
          },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });

    const plan = buildFleetSecretsPlan({ config: cfg, hostName: "clawdbot-fleet-host" });
    expect(plan.missing.some((m) => m.kind === "envVar" && m.envVar === "DISCORD_BOT_TOKEN")).toBe(true);
    expect(plan.warnings.some((w) => w.kind === "inlineToken" && w.path === "channels.discord.token")).toBe(true);
    expect(plan.warnings.some((w) => w.kind === "inlineToken" && w.suggestion?.includes("${DISCORD_BOT_TOKEN}"))).toBe(true);
  });

  it("suggests default secret names for env vars", async () => {
    const { suggestSecretNameForEnvVar } = await import("../src/lib/fleet-secrets-plan-helpers");

    expect(suggestSecretNameForEnvVar("OPENAI_API_KEY")).toBe("openai_api_key");
    expect(suggestSecretNameForEnvVar("DISCORD_BOT_TOKEN", "maren")).toBe("discord_token_maren");
  });
});
