import { describe, expect, it } from "vitest";

describe("clawlets config migrate", () => {
  it("migrates v8 -> v9 (removes legacy keys, wires discord token ref)", async () => {
    const { migrateClawletsConfigToV9 } = await import("../src/lib/clawlets-config-migrate");

    const raw = {
      schemaVersion: 8,
      fleet: {
        guildId: "123",
        envSecrets: { ZAI_API_KEY: "z_ai_api_key" },
        modelSecrets: { openai: "openai_api_key" },
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: { discordTokenSecret: "discord_token_maren" },
            clawdbot: { channels: { discord: { enabled: true } } },
          },
        },
      },
      hosts: { alpha: {} },
    };

    const res = migrateClawletsConfigToV9(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings).toEqual([]);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(9);
    expect(migrated.fleet.guildId).toBeUndefined();
    expect(migrated.fleet.envSecrets).toBeUndefined();
    expect(migrated.fleet.modelSecrets).toBeUndefined();

    expect(migrated.fleet.secretEnv.ZAI_API_KEY).toBe("z_ai_api_key");
    expect(migrated.fleet.secretEnv.OPENAI_API_KEY).toBe("openai_api_key");

    expect(migrated.fleet.bots.maren.profile.discordTokenSecret).toBeUndefined();
    expect(migrated.fleet.bots.maren.profile.secretEnv.DISCORD_BOT_TOKEN).toBe("discord_token_maren");
    expect(migrated.fleet.bots.maren.clawdbot.channels.discord.token).toBe("${DISCORD_BOT_TOKEN}");
  });

  it("warns on discordTokenSecret mismatch and keeps secretEnv", async () => {
    const { migrateClawletsConfigToV9 } = await import("../src/lib/clawlets-config-migrate");

    const raw = {
      schemaVersion: 8,
      fleet: {
        botOrder: ["maren"],
        bots: {
          maren: {
            profile: {
              secretEnv: { DISCORD_BOT_TOKEN: "discord_token_old" },
              discordTokenSecret: "discord_token_new",
            },
            clawdbot: { channels: { discord: { enabled: true } } },
          },
        },
      },
      hosts: { alpha: {} },
    };

    const res = migrateClawletsConfigToV9(raw);
    const migrated = res.migrated as any;
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.some((w) => w.includes("discordTokenSecret differs"))).toBe(true);

    expect(migrated.fleet.bots.maren.profile.discordTokenSecret).toBeUndefined();
    expect(migrated.fleet.bots.maren.profile.secretEnv.DISCORD_BOT_TOKEN).toBe("discord_token_old");
    expect(migrated.fleet.bots.maren.clawdbot.channels.discord.token).toBe("${DISCORD_BOT_TOKEN}");
  });

  it("migrates v9 -> v10 (moves host ssh keys to fleet)", async () => {
    const { migrateClawletsConfigToV10 } = await import("../src/lib/clawlets-config-migrate");

    const raw = {
      schemaVersion: 9,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        botOrder: [],
        bots: {},
      },
      hosts: {
        alpha: {
          sshAuthorizedKeys: ["ssh-ed25519 AAAATEST alpha"],
          sshKnownHosts: ["github.com ssh-ed25519 AAAATEST"],
        },
        beta: {
          sshAuthorizedKeys: ["ssh-ed25519 AAAATEST beta"],
        },
      },
    };

    const res = migrateClawletsConfigToV10(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated.fleet.sshAuthorizedKeys).toEqual(
      expect.arrayContaining(["ssh-ed25519 AAAATEST alpha", "ssh-ed25519 AAAATEST beta"]),
    );
    expect(migrated.fleet.sshKnownHosts).toEqual(
      expect.arrayContaining(["github.com ssh-ed25519 AAAATEST"]),
    );
    expect(migrated.hosts.alpha.sshAuthorizedKeys).toBeUndefined();
    expect(migrated.hosts.alpha.sshKnownHosts).toBeUndefined();
  });

  it("migrates v10 -> v12 (cache + selfUpdate mirrors)", async () => {
    const { migrateClawletsConfigToV12 } = await import("../src/lib/clawlets-config-migrate");

    const raw = {
      schemaVersion: 10,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        botOrder: [],
        bots: {},
      },
      hosts: {
        alpha: {
          cache: {
            garnix: {
              private: {
                enable: true,
                netrcSecret: "garnix_netrc",
                netrcPath: "/etc/nix/netrc",
                narinfoCachePositiveTtl: 123,
              },
            },
          },
          selfUpdate: {
            enable: true,
            interval: "30min",
            manifestUrl: "https://example.com/deploy/alpha/prod",
            publicKey: "key1",
            signatureUrl: "https://example.com/deploy/alpha/prod/latest.json.minisig",
          },
        },
      },
    };

    const res = migrateClawletsConfigToV12(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(12);

    expect(migrated.hosts.alpha.cache.garnix).toBeUndefined();
    expect(migrated.hosts.alpha.cache.substituters).toEqual(expect.any(Array));
    expect(migrated.hosts.alpha.cache.trustedPublicKeys).toEqual(expect.any(Array));
    expect(migrated.hosts.alpha.cache.netrc).toEqual({
      enable: true,
      secretName: "garnix_netrc",
      path: "/etc/nix/netrc",
      narinfoCachePositiveTtl: 123,
    });

    expect(migrated.hosts.alpha.selfUpdate.manifestUrl).toBeUndefined();
    expect(migrated.hosts.alpha.selfUpdate.publicKey).toBeUndefined();
    expect(migrated.hosts.alpha.selfUpdate.signatureUrl).toBeUndefined();

    expect(migrated.hosts.alpha.selfUpdate.enable).toBe(true);
    expect(migrated.hosts.alpha.selfUpdate.interval).toBe("30min");
    expect(migrated.hosts.alpha.selfUpdate.baseUrl).toBeUndefined();
    expect(migrated.hosts.alpha.selfUpdate.baseUrls).toEqual(["https://example.com/deploy/alpha/prod"]);
    expect(migrated.hosts.alpha.selfUpdate.channel).toBe("prod");
    expect(migrated.hosts.alpha.selfUpdate.publicKeys).toEqual(["key1"]);
    expect(migrated.hosts.alpha.selfUpdate.allowUnsigned).toBe(false);
    expect(migrated.hosts.alpha.selfUpdate.allowRollback).toBe(false);
    expect(migrated.hosts.alpha.selfUpdate.healthCheckUnit).toBe("");
  });

  it("migrates v12 -> v13 (moves typed surfaces out of clawdbot/profile)", async () => {
    const { migrateClawletsConfigToV13 } = await import("../src/lib/clawlets-config-migrate");

    const raw = {
      schemaVersion: 12,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        botOrder: ["bot1"],
        bots: {
          bot1: {
            profile: {
              secretEnv: {},
              secretFiles: {},
              hooks: { enabled: true, token: "${CLAWDBOT_HOOKS_TOKEN}" },
              skills: { allowBundled: ["brave-search"] },
            },
            clawdbot: {
              channels: {
                discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" },
              },
              agents: { defaults: { maxConcurrent: 3 } },
              hooks: { gmail: { pushToken: "${CLAWDBOT_HOOKS_GMAIL_PUSH_TOKEN}" } },
              skills: { entries: { "brave-search": { apiKeySecret: "brave_api_key" } } },
              plugins: { enabled: true, allow: ["@clawlets/plugin-cattle"] },
            },
          },
        },
      },
      hosts: { alpha: { enable: false } },
    };

    const res = migrateClawletsConfigToV13(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(13);
    expect(migrated.fleet.bots.bot1.channels).toEqual({
      discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" },
    });
    expect(migrated.fleet.bots.bot1.clawdbot.channels).toBeUndefined();
    expect(migrated.fleet.bots.bot1.clawdbot.agents).toBeUndefined();
    expect(migrated.fleet.bots.bot1.clawdbot.hooks).toBeUndefined();
    expect(migrated.fleet.bots.bot1.clawdbot.skills).toBeUndefined();
    expect(migrated.fleet.bots.bot1.clawdbot.plugins).toBeUndefined();
    expect(migrated.fleet.bots.bot1.profile.hooks).toBeUndefined();
    expect(migrated.fleet.bots.bot1.profile.skills).toBeUndefined();

    expect(migrated.fleet.bots.bot1.agents).toEqual({ defaults: { maxConcurrent: 3 } });
    expect(migrated.fleet.bots.bot1.hooks).toEqual({
      enabled: true,
      token: "${CLAWDBOT_HOOKS_TOKEN}",
      gmail: { pushToken: "${CLAWDBOT_HOOKS_GMAIL_PUSH_TOKEN}" },
    });
    expect(migrated.fleet.bots.bot1.skills).toEqual({
      allowBundled: ["brave-search"],
      entries: { "brave-search": { apiKeySecret: "brave_api_key" } },
    });
    expect(migrated.fleet.bots.bot1.plugins).toEqual({ enabled: true, allow: ["@clawlets/plugin-cattle"] });
  });

  it("migrates v16 -> v18 to latest", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/clawlets-config-migrate");
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");

    const raw = {
      schemaVersion: 16,
      defaultHost: "alpha",
      fleet: {
        secretEnv: {},
        secretFiles: {},
        gatewayOrder: ["bot1"],
        gateways: { bot1: {} },
        codex: { enable: true, gateways: ["bot1"] },
      },
      hosts: { alpha: { enable: false } },
    };

    const res = migrateClawletsConfigToLatest(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(18);
    expect(migrated.fleet?.gateways).toBeUndefined();
    expect(migrated.fleet?.gatewayOrder).toBeUndefined();
    expect(migrated.fleet?.codex?.bots).toBeUndefined();
    expect(migrated.fleet?.codex?.gateways).toEqual(["bot1"]);
    expect(migrated.hosts?.alpha?.gatewaysOrder).toEqual(["bot1"]);
    expect(migrated.hosts?.alpha?.gateways?.bot1).toBeTruthy();

    expect(() => ClawletsConfigSchema.parse(migrated)).not.toThrow();
  });

  it("migrates v12 -> v18 to latest (chained)", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/clawlets-config-migrate");
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");

    const raw = {
      schemaVersion: 12,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        botOrder: ["bot1"],
        bots: {
          bot1: {
            profile: {
              secretEnv: {},
              secretFiles: {},
              hooks: { enabled: true, token: "${CLAWDBOT_HOOKS_TOKEN}" },
              skills: { allowBundled: ["brave-search"] },
            },
            clawdbot: {
              channels: {
                discord: { enabled: true, token: "${DISCORD_BOT_TOKEN}" },
              },
              hooks: { gmail: { pushToken: "${CLAWDBOT_HOOKS_GMAIL_PUSH_TOKEN}" } },
              skills: { entries: { "brave-search": { apiKeySecret: "brave_api_key" } } },
            },
          },
        },
      },
      hosts: { alpha: { enable: false } },
    };

    const res = migrateClawletsConfigToLatest(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);

    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(18);
    expect(migrated.fleet?.bots).toBeUndefined();
    expect(migrated.fleet?.botOrder).toBeUndefined();
    expect(migrated.fleet?.gateways).toBeUndefined();
    expect(migrated.fleet?.gatewayOrder).toBeUndefined();

    expect(migrated.hosts?.alpha?.gatewaysOrder).toEqual(["bot1"]);
    expect(migrated.hosts?.alpha?.gateways?.bot1).toBeTruthy();

    expect(() => ClawletsConfigSchema.parse(migrated)).not.toThrow();
  });

  it("migrates v14 -> v15 (renames clawdbot)", async () => {
    const { migrateClawletsConfigToV15 } = await import("../src/lib/clawlets-config-migrate");

    const raw = {
      schemaVersion: 14,
      fleet: {
        secretEnv: {},
        secretFiles: {},
        botOrder: ["bot1"],
        bots: {
          bot1: {
            profile: { secretEnv: {}, secretFiles: {} },
            openclaw: { logging: { redactSensitive: "off" }, channels: { telegram: { enabled: true } }, agents: { defaults: { maxConcurrent: 2 } } },
            clawdbot: { channels: { discord: { enabled: true } } },
          },
        },
      },
      cattle: { enabled: false, hetzner: { image: "", serverType: "cx22", location: "nbg1", maxInstances: 10, defaultTtl: "2h", labels: { "managed-by": "clawlets" } }, defaults: { autoShutdown: true, callbackUrl: "" } },
      hosts: { alpha: { enable: false } },
    };

    const res = migrateClawletsConfigToV15(raw);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    const migrated = res.migrated as any;
    expect(migrated.schemaVersion).toBe(15);
    expect(migrated.fleet.bots.bot1.clawdbot).toBeUndefined();
    expect(migrated.fleet.bots.bot1.channels).toEqual({ telegram: { enabled: true }, discord: { enabled: true } });
    expect(migrated.fleet.bots.bot1.agents).toEqual({ defaults: { maxConcurrent: 2 } });
    expect(migrated.fleet.bots.bot1.openclaw).toEqual({ logging: { redactSensitive: "off" } });
  });
});
