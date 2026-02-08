import { describe, expect, it } from "vitest";
import { hasActiveLease, normalizeRetentionDays } from "../convex/ops/retentionHelpers";

describe("retention primitives", () => {
  it("normalizes retention days into safe bounds", () => {
    expect(normalizeRetentionDays(undefined)).toBe(30);
    expect(normalizeRetentionDays(0)).toBe(1);
    expect(normalizeRetentionDays(366)).toBe(365);
    expect(normalizeRetentionDays(90.8)).toBe(90);
  });

  it("detects active leases", () => {
    expect(hasActiveLease(undefined, 100)).toBe(false);
    expect(hasActiveLease(100, 100)).toBe(false);
    expect(hasActiveLease(101, 100)).toBe(true);
  });
});
