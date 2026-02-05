import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const flakeLockPath = path.join(repoRoot, "flake.lock");

function readPinnedRev(): string {
  if (!fs.existsSync(flakeLockPath)) return "";
  const lock = JSON.parse(fs.readFileSync(flakeLockPath, "utf8"));
  return String(lock?.nodes?.["openclaw-src"]?.locked?.rev || "").trim();
}

describe("openclaw schema artifact", () => {
  it("includes schema metadata", async () => {
    const { getPinnedOpenclawSchemaArtifact } = await import("../src/lib/openclaw/schema/artifact");
    const schema = getPinnedOpenclawSchemaArtifact();
    expect(schema).toBeTruthy();
    expect(schema.schema && typeof schema.schema).toBe("object");
    expect(schema.uiHints && typeof schema.uiHints).toBe("object");
    expect(typeof schema.version).toBe("string");
    expect(schema.version.length).toBeGreaterThan(0);
    expect(typeof schema.generatedAt).toBe("string");
    expect(typeof schema.openclawRev).toBe("string");
    expect(schema.openclawRev?.match(/^[0-9a-f]{7,}$/)).toBeTruthy();
    expect(schema.generatedAt).toBe(schema.openclawRev);
    const pinnedRev = readPinnedRev();
    if (pinnedRev) expect(schema.openclawRev).toBe(pinnedRev);
  });
});
