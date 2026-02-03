import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("clawlets config schema", () => {
  it("assertSafeHostName rejects invalid names", async () => {
    const { assertSafeHostName } = await import("../src/lib/clawlets-config");
    expect(() => assertSafeHostName("../pwn")).toThrow(/invalid host name/i);
  });

  it("assertSafeHostName accepts valid names", async () => {
    const { assertSafeHostName } = await import("../src/lib/clawlets-config");
    expect(() => assertSafeHostName("openclaw-fleet-host")).not.toThrow();
  });

  it("rejects unsafe host names (path traversal)", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "../pwn": {
            enable: false,
            botsOrder: ["maren"],
            bots: { maren: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/invalid host name/i);
  });

  it("rejects duplicate gateway ids", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            botsOrder: ["maren", "maren"],
            bots: { maren: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/duplicate bot id/i);
  });

  it("rejects missing botsOrder when bots present", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            botsOrder: [],
            bots: { maren: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/botsOrder must be set/i);
  });

  it("rejects botsOrder with unknown bot id", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            botsOrder: ["maren", "ghost"],
            bots: { maren: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/unknown bot id/i);
  });

  it("rejects botsOrder missing bots", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            botsOrder: ["maren"],
            bots: { maren: {}, sonja: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/botsOrder missing bots/i);
  });

  it("rejects legacy fleet.bots and fleet.botOrder", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            botsOrder: [],
            bots: {},
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/fleet\.bots/i);
  });

  it("rejects invalid adminCidr values", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            provisioning: { adminCidr: "not-a-cidr", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/adminCidr/i);
  });

  it("rejects world-open adminCidr unless explicitly allowed", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            provisioning: { adminCidr: "0.0.0.0/0", sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/adminCidrAllowWorldOpen/i);
  });

  it("accepts world-open adminCidr when explicitly allowed", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            provisioning: {
              adminCidr: "0.0.0.0/0",
              adminCidrAllowWorldOpen: true,
              sshPubkeyFile: "~/.ssh/id_ed25519.pub",
            },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).not.toThrow();
  });

  it("createDefaultClawletsConfig trims and defaults", async () => {
    const { createDefaultClawletsConfig } = await import("../src/lib/clawlets-config");
    const cfg = createDefaultClawletsConfig({ host: "   ", bots: [" maren ", "", "sonja"] });
    expect(Object.keys(cfg.hosts)).toEqual(["openclaw-fleet-host"]);
    expect(cfg.defaultHost).toBe("openclaw-fleet-host");
    expect(cfg.hosts["openclaw-fleet-host"].botsOrder).toEqual(["maren", "sonja"]);
    expect(Object.keys(cfg.hosts["openclaw-fleet-host"].bots)).toEqual(["maren", "sonja"]);
    expect(cfg.fleet.secretEnv).toEqual({ ZAI_API_KEY: "z_ai_api_key" });
    expect(cfg.hosts["openclaw-fleet-host"].bots.maren.profile.secretEnv).toEqual({});
    expect(cfg.cattle.enabled).toBe(false);
    expect(cfg.cattle.hetzner.defaultTtl).toBe("2h");
    expect(cfg.hosts["openclaw-fleet-host"].sshExposure?.mode).toBe("bootstrap");
    expect(cfg.hosts["openclaw-fleet-host"].cache?.netrc?.enable).toBe(false);
    expect(cfg.hosts["openclaw-fleet-host"].provisioning?.adminCidrAllowWorldOpen).toBe(false);
    expect(cfg.hosts["openclaw-fleet-host"].agentModelPrimary).toBe("zai/glm-4.7");
  });

  it("does not share default object references across parses", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const baseHost = {
      enable: false,
      botsOrder: ["maren"],
      bots: { maren: {} },
      diskDevice: "/dev/sda",
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    const cfgA = ClawletsConfigSchema.parse({
      schemaVersion: 17,
      hosts: { "openclaw-fleet-host": baseHost },
    }) as any;

    cfgA.fleet.secretEnv.NEW_ENV_VAR = "new_secret";
    cfgA.hosts["openclaw-fleet-host"].bots.maren.profile.secretEnv.LOCAL_ENV_VAR = "local_secret";

    const cfgB = ClawletsConfigSchema.parse({
      schemaVersion: 17,
      hosts: { "openclaw-fleet-host": baseHost },
    }) as any;

    expect(cfgB.fleet.secretEnv.NEW_ENV_VAR).toBeUndefined();
    expect(cfgB.hosts["openclaw-fleet-host"].bots.maren.profile.secretEnv.LOCAL_ENV_VAR).toBeUndefined();
  });

  it("rejects defaultHost not present in hosts", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        defaultHost: "missing-host",
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/defaultHost not found/i);
  });

  it("resolveHostName uses defaultHost and sole-host fallback", async () => {
    const { resolveHostName } = await import("../src/lib/clawlets-config");
    const baseHost = {
      enable: false,
      diskDevice: "/dev/sda",
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    {
      const config = { schemaVersion: 8, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r).toEqual({ ok: true, host: "a", source: "defaultHost" });
    }

    {
      const config = { schemaVersion: 8, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: "a" });
      expect(r).toEqual({ ok: true, host: "a", source: "flag" });
    }

    {
      const config = { schemaVersion: 8, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: "b" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/unknown host/i);
    }

    {
      const config = { schemaVersion: 8, fleet: {}, hosts: { a: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r).toEqual({ ok: true, host: "a", source: "soleHost" });
    }

    {
      const config = { schemaVersion: 8, fleet: {}, hosts: { a: baseHost, b: baseHost } } as any;
      const r = resolveHostName({ config, host: undefined });
      expect(r.ok).toBe(false);
    }
  });

  it("resolveHostName returns ok=false for invalid --host tokens", async () => {
    const { resolveHostName } = await import("../src/lib/clawlets-config");
    const baseHost = {
      enable: false,
      diskDevice: "/dev/sda",
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    const config = { schemaVersion: 8, defaultHost: "a", fleet: {}, hosts: { a: baseHost } } as any;
    const r = resolveHostName({ config, host: ";" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/invalid host name/i);
  });

  it("loadClawletsConfig throws for missing config file", async () => {
    const { loadClawletsConfig } = await import("../src/lib/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-missing-"));
    try {
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/missing clawlets config/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawletsConfig throws for invalid JSON", async () => {
    const { loadClawletsConfig } = await import("../src/lib/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-badjson-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), "{", "utf8");
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/invalid JSON/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawletsConfig rejects legacy publicSsh key", async () => {
    const { loadClawletsConfig } = await import("../src/lib/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-legacy-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      const legacy = {
        schemaVersion: 17,
        fleet: { secretEnv: {}, secretFiles: {} },
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            publicSsh: { enable: false },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      };
      await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), JSON.stringify(legacy, null, 2), "utf8");
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/legacy host config key publicSsh/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawletsConfig rejects legacy opentofu key", async () => {
    const { loadClawletsConfig } = await import("../src/lib/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-legacy-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      const legacy = {
        schemaVersion: 17,
        fleet: { secretEnv: {}, secretFiles: {} },
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            opentofu: {},
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      };
      await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), JSON.stringify(legacy, null, 2), "utf8");
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/legacy host config key opentofu/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawletsConfig rejects legacy host ssh keys", async () => {
    const { loadClawletsConfig } = await import("../src/lib/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-legacy-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      const legacy = {
        schemaVersion: 17,
        fleet: { secretEnv: {}, secretFiles: {} },
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            sshAuthorizedKeys: ["ssh-ed25519 AAAATEST legacy"],
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      };
      await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), JSON.stringify(legacy, null, 2), "utf8");
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/host SSH keys are now project-scoped/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid fleet.secretEnv entries", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        fleet: {
          secretEnv: { "bad-key": "../pwn" },
        },
        hosts: {
          "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/invalid (env var name|secret name)/i);
  });

  it("loadClawletsConfig rejects legacy envSecrets keys", async () => {
    const { loadClawletsConfig } = await import("../src/lib/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-envsecrets-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      const legacy = {
        schemaVersion: 17,
        fleet: { secretEnv: {}, secretFiles: {} },
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            botsOrder: ["maren"],
            bots: { maren: { profile: { envSecrets: { DISCORD_BOT_TOKEN: "discord_token_maren" } } } },
            diskDevice: "/dev/sda",
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      };
      await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), JSON.stringify(legacy, null, 2), "utf8");
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/envSecrets was removed/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid cattle ttl strings", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        cattle: { enabled: true, hetzner: { image: "img-1", defaultTtl: "2 hours" } },
        hosts: {
          "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/invalid ttl/i);
  });

  it("rejects cattle enabled without image", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        cattle: { enabled: true, hetzner: { image: "" } },
        hosts: {
          "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/cattle\.hetzner\.image must be set/i);
  });

  it("rejects invalid cattle labels", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 17,
        cattle: { enabled: false, hetzner: { labels: { "bad key": "x" } } },
        hosts: {
          "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/invalid label key/i);
  });

  it("getTailnetMode normalizes to none/tailscale", async () => {
    const { getTailnetMode } = await import("../src/lib/clawlets-config");
    expect(getTailnetMode({ tailnet: { mode: "tailscale" } } as any)).toBe("tailscale");
    expect(getTailnetMode({ tailnet: { mode: "none" } } as any)).toBe("none");
    expect(getTailnetMode({ tailnet: { mode: "weird" } } as any)).toBe("none");
    expect(getTailnetMode(undefined)).toBe("none");
  });
});
