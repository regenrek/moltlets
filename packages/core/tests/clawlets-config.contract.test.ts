import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("clawlets config schema", () => {
  it("assertSafeHostName rejects invalid names", async () => {
    const { assertSafeHostName } = await import("../src/lib/config/clawlets-config");
    expect(() => assertSafeHostName("../pwn")).toThrow(/invalid host name/i);
  });

  it("assertSafeHostName accepts valid names", async () => {
    const { assertSafeHostName } = await import("../src/lib/config/clawlets-config");
    expect(() => assertSafeHostName("openclaw-fleet-host")).not.toThrow();
  });

  it("rejects unsafe host names (path traversal)", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "../pwn": {
            enable: false,
            gatewaysOrder: ["maren"],
            gateways: { maren: {} },
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
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            gatewaysOrder: ["maren", "maren"],
            gateways: { maren: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/duplicate gateway id/i);
  });

  it("rejects missing gatewaysOrder when gateways present", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            gatewaysOrder: [],
            gateways: { maren: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/gatewaysOrder must be set/i);
  });

  it("rejects gatewaysOrder with unknown gateway id", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            gatewaysOrder: ["maren", "ghost"],
            gateways: { maren: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/unknown gateway id/i);
  });

  it("rejects gatewaysOrder missing gateways", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            gatewaysOrder: ["maren"],
            gateways: { maren: {}, sonja: {} },
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/gatewaysOrder missing gateways/i);
  });

  it("rejects openclaw.enable without gateways", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            openclaw: { enable: true },
            gatewaysOrder: [],
            gateways: {},
            diskDevice: "/dev/sda",
            sshExposure: { mode: "tailnet" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/openclaw\.enable requires at least one gateway/i);
  });

  it("rejects legacy fleet.bots and fleet.botOrder", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        fleet: { botOrder: ["maren"], bots: { maren: {} } },
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            gatewaysOrder: [],
            gateways: {},
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
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
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
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
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
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
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

  it("rejects aws provider without required fields", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            provisioning: { provider: "aws" },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/aws\.region/i);
  });

  it("rejects aws default VPC when vpc/subnet are set", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            provisioning: { provider: "aws" },
            aws: {
              region: "us-east-1",
              instanceType: "t3.large",
              amiId: "ami-0123456789abcdef0",
              vpcId: "vpc-1234",
              subnetId: "",
              useDefaultVpc: true,
            },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/useDefaultVpc/i);
  });

  it("rejects aws provider when amiId is missing", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            provisioning: { provider: "aws" },
            aws: {
              region: "us-east-1",
              instanceType: "t3.large",
              amiId: "",
              vpcId: "vpc-1234",
              subnetId: "",
              useDefaultVpc: false,
            },
            sshExposure: { mode: "bootstrap" },
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
          },
        },
      }),
    ).toThrow(/aws\.amiId/i);
  });

  it("accepts aws provider with required fields", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            enable: false,
            diskDevice: "/dev/sda",
            provisioning: { provider: "aws" },
            aws: {
              region: "us-east-1",
              instanceType: "t3.large",
              amiId: "ami-0123456789abcdef0",
              vpcId: "vpc-1234",
              subnetId: "",
              useDefaultVpc: false,
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
    const { createDefaultClawletsConfig } = await import("../src/lib/config/clawlets-config");
    const cfg = createDefaultClawletsConfig({ host: "   ", gateways: [" maren ", "", "sonja"] });
    expect(Object.keys(cfg.hosts)).toEqual(["openclaw-fleet-host"]);
    expect(cfg.defaultHost).toBe("openclaw-fleet-host");
    expect(cfg.hosts["openclaw-fleet-host"].gatewaysOrder).toEqual(["maren", "sonja"]);
    expect(Object.keys(cfg.hosts["openclaw-fleet-host"].gateways)).toEqual(["maren", "sonja"]);
    expect(cfg.fleet.secretEnv).toEqual({ ZAI_API_KEY: "z_ai_api_key" });
    expect(cfg.hosts["openclaw-fleet-host"].gateways.maren.profile.secretEnv).toEqual({});
    expect(cfg.hosts["openclaw-fleet-host"].openclaw.enable).toBe(false);
    expect(cfg.hosts["openclaw-fleet-host"].sshExposure?.mode).toBe("bootstrap");
    expect(cfg.hosts["openclaw-fleet-host"].cache?.netrc?.enable).toBe(false);
    expect(cfg.hosts["openclaw-fleet-host"].provisioning?.adminCidrAllowWorldOpen).toBe(false);
    expect(cfg.hosts["openclaw-fleet-host"].provisioning?.provider).toBe("hetzner");
    expect(cfg.hosts["openclaw-fleet-host"].hetzner?.allowTailscaleUdpIngress).toBe(true);
    expect(cfg.hosts["openclaw-fleet-host"].aws?.useDefaultVpc).toBe(false);
    expect(cfg.hosts["openclaw-fleet-host"].aws?.allowTailscaleUdpIngress).toBe(true);
    expect(cfg.hosts["openclaw-fleet-host"].aws?.amiId).toBe("");
    expect(cfg.hosts["openclaw-fleet-host"].agentModelPrimary).toBe("zai/glm-4.7");
  });

  it("does not share default object references across parses", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    const baseHost = {
      enable: false,
      gatewaysOrder: ["maren"],
      gateways: { maren: {} },
      diskDevice: "/dev/sda",
      sshExposure: { mode: "tailnet" },
      tailnet: { mode: "none" },
      agentModelPrimary: "zai/glm-4.7",
    } as const;

    const cfgA = ClawletsConfigSchema.parse({
      schemaVersion: 2,
      hosts: { "openclaw-fleet-host": baseHost },
    }) as any;

    cfgA.fleet.secretEnv.NEW_ENV_VAR = "new_secret";
    cfgA.hosts["openclaw-fleet-host"].gateways.maren.profile.secretEnv.LOCAL_ENV_VAR = "local_secret";

    const cfgB = ClawletsConfigSchema.parse({
      schemaVersion: 2,
      hosts: { "openclaw-fleet-host": baseHost },
    }) as any;

    expect(cfgB.fleet.secretEnv.NEW_ENV_VAR).toBeUndefined();
    expect(cfgB.hosts["openclaw-fleet-host"].gateways.maren.profile.secretEnv.LOCAL_ENV_VAR).toBeUndefined();
  });

  it("rejects defaultHost not present in hosts", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
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
    const { resolveHostName } = await import("../src/lib/config/clawlets-config");
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
    const { resolveHostName } = await import("../src/lib/config/clawlets-config");
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
    const { loadClawletsConfig } = await import("../src/lib/config/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-missing-"));
    try {
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/missing clawlets config/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawletsConfig throws for invalid JSON", async () => {
    const { loadClawletsConfig } = await import("../src/lib/config/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-badjson-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), "{", "utf8");
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/invalid JSON/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("loadClawletsConfig rejects schemaVersion v1 (pre-release)", async () => {
    const { loadClawletsConfig } = await import("../src/lib/config/clawlets-config");
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-config-v1-"));
    try {
      await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
      const legacy = {
        schemaVersion: 1,
        hosts: { "openclaw-fleet-host": { enable: false } },
      };
      await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), JSON.stringify(legacy, null, 2), "utf8");
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/schemaVersion/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid fleet.secretEnv entries", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        fleet: {
          secretEnv: { "bad-key": "../pwn" },
        },
        hosts: {
          "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/invalid (env var name|secret name)/i);
  });

  it("rejects legacy cattle config key", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        cattle: {},
        hosts: {
          "openclaw-fleet-host": { tailnet: { mode: "none" }, agentModelPrimary: "zai/glm-4.7" },
        },
      }),
    ).toThrow(/cattle/i);
  });

  it("rejects legacy gateway clf key", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/config/clawlets-config");
    expect(() =>
      ClawletsConfigSchema.parse({
        schemaVersion: 2,
        hosts: {
          "openclaw-fleet-host": {
            tailnet: { mode: "none" },
            agentModelPrimary: "zai/glm-4.7",
            gatewaysOrder: ["maren"],
            gateways: {
              maren: {
                clf: {},
              },
            },
          },
        },
      }),
    ).toThrow(/clf/i);
  });

  it("getTailnetMode normalizes to none/tailscale", async () => {
    const { getTailnetMode } = await import("../src/lib/config/clawlets-config");
    expect(getTailnetMode({ tailnet: { mode: "tailscale" } } as any)).toBe("tailscale");
    expect(getTailnetMode({ tailnet: { mode: "none" } } as any)).toBe("none");
    expect(getTailnetMode({ tailnet: { mode: "weird" } } as any)).toBe("none");
    expect(getTailnetMode(undefined)).toBe("none");
  });
});
