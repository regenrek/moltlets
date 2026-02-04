import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

function baseConfig(host: string) {
  return {
    schemaVersion: 18,
    defaultHost: host,
    baseFlake: "",
    fleet: {
      secretEnv: {},
      secretFiles: {},
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      codex: { enable: false, gateways: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    cattle: {
      enabled: false,
      hetzner: {
        image: "",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labels: { "managed-by": "clawlets" },
      },
      defaults: { autoShutdown: true, callbackUrl: "" },
    },
    hosts: {
      [host]: {
        enable: false,
        gatewaysOrder: ["agent"],
        gateways: {
          agent: {
            profile: { secretEnv: {}, secretFiles: {} },
            channels: {
              whatsapp: { enabled: true, dmPolicy: "open", allowFrom: ["*"] },
            },
            openclaw: {},
            clf: {},
          },
        },
        diskDevice: "/dev/sda",
        flakeHost: "",
        hetzner: { serverType: "cx22" },
        provisioning: {
          adminCidr: "",
          adminCidrAllowWorldOpen: false,
          sshPubkeyFile: "~/.ssh/id_ed25519.pub",
        },
        cache: {
          substituters: ["https://cache.nixos.org", "https://cache.garnix.io"],
          trustedPublicKeys: [
            "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=",
            "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
          ],
          netrc: { enable: false, secretName: "garnix_netrc", path: "/etc/nix/netrc", narinfoCachePositiveTtl: 3600 },
        },
        operator: { deploy: { enable: false } },
        sshExposure: { mode: "bootstrap" },
        tailnet: { mode: "none" },
        selfUpdate: {
          enable: false,
          interval: "30min",
          baseUrls: [],
          channel: "prod",
          publicKeys: [],
          previousPublicKeys: [],
          previousPublicKeysValidUntil: "",
          allowUnsigned: false,
          allowRollback: false,
          healthCheckUnit: "",
        },
      },
    },
  };
}

describe("openclaw harden command", () => {
  const originalCwd = process.cwd();
  let dir = "";
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    dir = await mkdtemp(path.join(tmpdir(), "clawlets-harden-"));
    await writeFile(path.join(dir, "flake.nix"), "# test\n", "utf8");
    await mkdir(path.join(dir, "scripts"));
    await mkdir(path.join(dir, "fleet"));
    await writeFile(
      path.join(dir, "fleet", "clawlets.json"),
      `${JSON.stringify(baseConfig("openclaw-fleet-host"), null, 2)}\n`,
      "utf8",
    );
    process.chdir(dir);
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.chdir(originalCwd);
  });

  it("prints a plan when --write is not set", async () => {
    const { openclawHarden } = await import("../src/commands/openclaw/harden.js");
    await openclawHarden.run({ args: {} } as any);
    const out = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(out).toMatch(/planned: update fleet\/clawlets\.json/);
    expect(out).toMatch(/hosts\.openclaw-fleet-host\.gateways\.agent\.openclaw\.logging\.redactSensitive/);
    expect(out).toMatch(/hosts\.openclaw-fleet-host\.gateways\.agent\.openclaw\.session\.dmScope/);
    expect(out).toMatch(/hosts\.openclaw-fleet-host\.gateways\.agent\.channels\.whatsapp\.dmPolicy/);
    expect(out).toMatch(/hosts\.openclaw-fleet-host\.gateways\.agent\.channels\.whatsapp\.groupPolicy/);
  });

  it("writes changes when --write is set", async () => {
    const { openclawHarden } = await import("../src/commands/openclaw/harden.js");
    await openclawHarden.run({ args: { write: true } } as any);
    const raw = await readFile(path.join(dir, "fleet", "clawlets.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.hosts["openclaw-fleet-host"].gateways.agent.openclaw.logging.redactSensitive).toBe("tools");
    expect(parsed.hosts["openclaw-fleet-host"].gateways.agent.openclaw.session.dmScope).toBe("per-channel-peer");
    expect(parsed.hosts["openclaw-fleet-host"].gateways.agent.channels.whatsapp.dmPolicy).toBe("pairing");
    expect(parsed.hosts["openclaw-fleet-host"].gateways.agent.channels.whatsapp.groupPolicy).toBe("allowlist");
  });
});
