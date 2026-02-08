import { describe, expect, it } from "vitest";
import { __test_hasActiveLease, __test_normalizeRetentionDays } from "../convex/retention";

describe("retention primitives", () => {
  it("normalizes retention days into safe bounds", () => {
    expect(__test_normalizeRetentionDays(undefined)).toBe(30);
    expect(__test_normalizeRetentionDays(0)).toBe(1);
    expect(__test_normalizeRetentionDays(366)).toBe(365);
    expect(__test_normalizeRetentionDays(90.8)).toBe(90);
  });

  it("detects active leases", () => {
    expect(__test_hasActiveLease(undefined, 100)).toBe(false);
    expect(__test_hasActiveLease(100, 100)).toBe(false);
    expect(__test_hasActiveLease(101, 100)).toBe(true);
  });
});
