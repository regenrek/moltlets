import { describe, expect, it } from "vitest";

import * as clawletsConfigBarrel from "../src/lib/config/clawlets-config.js";
import * as clawletsConfigIndex from "../src/lib/config/index.js";

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
});
