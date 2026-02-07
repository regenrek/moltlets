import { describe, expect, it } from "vitest";

describe("clawlets config migrate", () => {
  it("rejects pre-release schemaVersion v1", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/config/clawlets-config");
    expect(() => migrateClawletsConfigToLatest({ schemaVersion: 1 })).toThrow(/unsupported schemaVersion/i);
  });

  it("no-ops on current schemaVersion", async () => {
    const { CLAWLETS_CONFIG_SCHEMA_VERSION, migrateClawletsConfigToLatest } = await import("../src/lib/config/clawlets-config");
    const res = migrateClawletsConfigToLatest({ schemaVersion: CLAWLETS_CONFIG_SCHEMA_VERSION });
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.openclawConfig).toBeNull();
  });

  it("rejects unsupported schema versions", async () => {
    const { migrateClawletsConfigToLatest } = await import("../src/lib/config/clawlets-config");
    expect(() => migrateClawletsConfigToLatest({ schemaVersion: 3 })).toThrow(/unsupported schemaVersion/i);
    expect(() => migrateClawletsConfigToLatest({ schemaVersion: 18 })).toThrow(/unsupported schemaVersion/i);
  });
});
