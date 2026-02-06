import { describe, expect, it } from "vitest";

describe("clawlets config migrate", () => {
  it("migrates schemaVersion v1 to split schemaVersion v2", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/config/clawlets-config-migrate");

    const raw = {
      schemaVersion: 1,
      defaultHost: "alpha",
      fleet: {
        secretEnv: {},
        secretFiles: {},
        sshAuthorizedKeys: [],
        sshKnownHosts: [],
        codex: { enable: false, gateways: [] },
        backups: { restic: { enable: false, repository: "" } },
      },
      cattle: { enabled: false },
      hosts: {
        alpha: {
          enable: false,
          gatewaysOrder: [],
          gateways: {},
          openclaw: { enable: false },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    };
    const res = migrateClawletsConfigToLatest(raw);

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.migrated).not.toBe(raw);
    expect(res.migrated.schemaVersion).toBe(2);
    expect(res.openclawConfig).toBeTruthy();
  });

  it("rejects unsupported schema versions", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/config/clawlets-config-migrate");
    expect(() => migrateClawletsConfigToLatest({ schemaVersion: 3 })).toThrow(/unsupported schemaVersion/i);
    expect(() => migrateClawletsConfigToLatest({ schemaVersion: 18 })).toThrow(/unsupported schemaVersion/i);
  });
});
