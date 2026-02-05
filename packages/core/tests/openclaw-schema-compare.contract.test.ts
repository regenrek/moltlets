import { describe, expect, it } from "vitest";
import {
  summarizeOpenclawSchemaComparison,
  type OpenclawSchemaComparison,
} from "../src/lib/openclaw/schema/compare.js";

describe("openclaw schema comparison summary", () => {
  it("summarizes pinned ok and upstream error", () => {
    const comparison: OpenclawSchemaComparison = {
      schemaVersion: "1.0.0",
      schemaRev: "rev123",
      warnings: ["warn1"],
      pinned: { ok: true, nixOpenclawRev: "pinrev", openclawRev: "rev123", matches: true },
      upstream: { ok: false, nixOpenclawRef: "main", error: "rate limited" },
    };
    const summary = summarizeOpenclawSchemaComparison(comparison);
    expect(summary.pinned?.status).toBe("ok");
    expect(summary.upstream.ok).toBe(false);
    expect(summary.upstream.status).toBe("warn");
    expect(summary.warnings).toEqual(["warn1"]);
  });

  it("marks mismatch as warn with details", () => {
    const comparison: OpenclawSchemaComparison = {
      schemaVersion: "2.0.0",
      schemaRev: "rev000",
      warnings: [],
      pinned: { ok: true, nixOpenclawRev: "pinrev", openclawRev: "rev999", matches: false },
      upstream: { ok: true, nixOpenclawRef: "main", openclawRev: "rev999", matches: false },
    };
    const summary = summarizeOpenclawSchemaComparison(comparison);
    expect(summary.pinned?.status).toBe("warn");
    expect(summary.upstream.status).toBe("warn");
  });
});
