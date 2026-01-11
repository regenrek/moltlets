import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultClawdletsConfig, loadClawdletsConfig } from "../src/lib/clawdlets-config";

describe("clawdlets-config", () => {
  it("creates a default config", () => {
    const cfg = createDefaultClawdletsConfig({ host: "clawdbot-fleet-host", bots: ["alpha", "beta"] });
    expect(cfg.schemaVersion).toBe(1);
    expect(cfg.fleet.bots).toEqual(["alpha", "beta"]);
    expect(cfg.hosts["clawdbot-fleet-host"]).toBeDefined();
  });

  it("throws when config file is missing", () => {
    expect(() => loadClawdletsConfig({ repoRoot: "/definitely/does/not/exist" })).toThrow(/missing clawdlets config/i);
  });

  it("throws when JSON is invalid", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-config-"));
    await mkdir(path.join(repoRoot, "infra", "configs"), { recursive: true });
    await writeFile(path.join(repoRoot, "infra", "configs", "clawdlets.json"), "{", "utf8");
    expect(() => loadClawdletsConfig({ repoRoot })).toThrow(/invalid JSON/i);
  });

  it("throws when schema is invalid", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-config-"));
    await mkdir(path.join(repoRoot, "infra", "configs"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "infra", "configs", "clawdlets.json"),
      JSON.stringify({ schemaVersion: 1, fleet: {}, hosts: {} }, null, 2),
      "utf8",
    );
    expect(() => loadClawdletsConfig({ repoRoot })).toThrow();
  });

  it("loads a valid config", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawdlets-config-"));
    await mkdir(path.join(repoRoot, "infra", "configs"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "infra", "configs", "clawdlets.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          fleet: { guildId: "", bots: ["alpha"], botOverrides: {}, routingOverrides: {}, codex: { enable: false, bots: [] }, backups: { restic: { enable: false, repository: "" } } },
          hosts: { "clawdbot-fleet-host": { enable: false, bootstrapSsh: true, diskDevice: "/dev/disk/by-id/TEST", sshAuthorizedKeys: [], tailnet: { mode: "none", wireguardAdminPeers: [] }, agentModelPrimary: "zai/glm-4.7" } },
        },
        null,
        2,
      ),
      "utf8",
    );
    const { config } = loadClawdletsConfig({ repoRoot });
    expect(config.schemaVersion).toBe(1);
    expect(config.fleet.bots).toEqual(["alpha"]);
  });
});

