import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as clawletsConfigBarrel from "../src/lib/config/clawlets-config.js";
import * as clawletsConfigIndex from "../src/lib/config/index.js";
import { loadClawletsConfig } from "../src/lib/config/io.js";

function minimalInfraConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 2,
    defaultHost: "alpha",
    fleet: {
      secretEnv: {},
      secretFiles: {},
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      backups: { restic: { enable: false, repository: "" } },
    },
    hosts: {
      alpha: {},
    },
    ...(overrides ?? {}),
  };
}

describe("clawlets-config barrel", () => {
  it("loads the barrel module directly at runtime", async () => {
    const loaded = await import("../src/lib/config/clawlets-config.ts");
    expect(typeof loaded.loadClawletsConfig).toBe("function");
  });

  it("re-exports canonical config API from index", () => {
    expect(clawletsConfigBarrel.loadClawletsConfig).toBe(clawletsConfigIndex.loadClawletsConfig);
    expect(clawletsConfigBarrel.loadInfraConfig).toBe(clawletsConfigIndex.loadInfraConfig);
    expect(clawletsConfigBarrel.assertSafeHostName).toBe(clawletsConfigIndex.assertSafeHostName);
  });

  it("preserves host-name validation through barrel import", () => {
    expect(() => clawletsConfigBarrel.assertSafeHostName("openclaw-fleet-host")).not.toThrow();
    expect(() => clawletsConfigBarrel.assertSafeHostName("INVALID_HOST")).toThrow();
  });

  it("loads split config from disk with boundary-safe parsing", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "clawlets-config-unit-"));
    const fleetDir = path.join(repoRoot, "fleet");
    await mkdir(fleetDir, { recursive: true });
    try {
      await writeFile(
        path.join(fleetDir, "clawlets.json"),
        `${JSON.stringify(minimalInfraConfig(), null, 2)}\n`,
        "utf8",
      );
      const loaded = loadClawletsConfig({ repoRoot });
      expect(loaded.config.defaultHost).toBe("alpha");
      expect(Object.keys(loaded.config.hosts)).toEqual(["alpha"]);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails fast for legacy schemaVersion=1 without migration fallback", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "clawlets-config-unit-v1-"));
    const fleetDir = path.join(repoRoot, "fleet");
    await mkdir(fleetDir, { recursive: true });
    try {
      await writeFile(
        path.join(fleetDir, "clawlets.json"),
        `${JSON.stringify(minimalInfraConfig({ schemaVersion: 1 }), null, 2)}\n`,
        "utf8",
      );
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/schemaVersion/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("surfaces merge error paths when infra/openclaw secretEnv collisions exist", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "clawlets-config-unit-collision-"));
    const fleetDir = path.join(repoRoot, "fleet");
    await mkdir(fleetDir, { recursive: true });
    try {
      await writeFile(
        path.join(fleetDir, "clawlets.json"),
        `${JSON.stringify(minimalInfraConfig({
          fleet: {
            secretEnv: { OPENCLAW_DISCORD_TOKEN: "discord_token" },
            secretFiles: {},
            sshAuthorizedKeys: [],
            sshKnownHosts: [],
            backups: { restic: { enable: false, repository: "" } },
          },
        }), null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(fleetDir, "openclaw.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          hosts: {},
          fleet: {
            secretEnv: { OPENCLAW_DISCORD_TOKEN: "discord_token_openclaw" },
            secretFiles: {},
            gatewayArchitecture: "multi",
            codex: { enable: false, gateways: [] },
          },
        }, null, 2)}\n`,
        "utf8",
      );
      expect(() => loadClawletsConfig({ repoRoot })).toThrow(/fleet\.secretEnv collisions/i);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
