import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { readCliVersion } from "../src/lib/version.js";

describe("readCliVersion", () => {
  it("reads version from package.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cli-version-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
    expect(readCliVersion(dir)).toBe("1.2.3");
  });

  it("throws when version is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawdlets-cli-version-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({}), "utf8");
    expect(() => readCliVersion(dir)).toThrow(/missing version/i);
  });
});
