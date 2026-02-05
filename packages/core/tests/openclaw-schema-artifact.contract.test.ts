import { describe, expect, it } from "vitest";
import { parseOpenclawSchemaArtifact } from "../src/lib/openclaw/schema/artifact.js";

describe("openclaw schema artifact parse", () => {
  it("accepts valid artifact", () => {
    const res = parseOpenclawSchemaArtifact({
      schema: { type: "object" },
      uiHints: { title: "ok" },
      version: "1.0.0",
      generatedAt: "now",
      openclawRev: "rev123",
    });
    expect(res.ok).toBe(true);
  });

  it("accepts legacy clawdbotRev key during migration", () => {
    const res = parseOpenclawSchemaArtifact({
      schema: { type: "object" },
      uiHints: { title: "ok" },
      version: "1.0.0",
      generatedAt: "now",
      clawdbotRev: "rev123",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.openclawRev).toBe("rev123");
  });

  it("rejects missing required fields", () => {
    const res = parseOpenclawSchemaArtifact({ schema: {}, uiHints: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("schema payload missing required fields");
    }
  });
});
