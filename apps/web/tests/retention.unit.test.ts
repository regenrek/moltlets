import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { __test_decodePolicyCursor, __test_encodePolicyCursor } from "../convex/ops/retention";
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

  it("encodes and decodes policy cursors", () => {
    const projectId = "proj_123" as Id<"projects">;
    const cursor = __test_encodePolicyCursor(projectId);
    expect(cursor).toBe("project:proj_123");
    expect(__test_decodePolicyCursor(cursor)).toBe(projectId);
  });

  it("rejects invalid policy cursor formats", () => {
    expect(() => __test_decodePolicyCursor("opaque-cursor-token")).toThrow(/invalid retention sweep cursor format/i);
    expect(() => __test_decodePolicyCursor("project:")).toThrow(/invalid retention sweep cursor payload/i);
    expect(__test_decodePolicyCursor(undefined)).toBeNull();
  });

  it("does not use paginate in retention sweep mutation", () => {
    const source = readFileSync(new URL("../convex/ops/retention.ts", import.meta.url), "utf8");
    expect(source).not.toContain(".paginate(");
  });
});
