import { describe, it, expect } from "vitest";
import { parseAgeKeyFile, parseAgeKeygenOutput } from "../src/lib/age";

describe("age", () => {
  it("parses age-keygen output", () => {
    const out = [
      "# created: 2026-01-10T00:00:00Z",
      "# public key: age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq0l9p4",
      "AGE-SECRET-KEY-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "",
    ].join("\n");
    const parsed = parseAgeKeygenOutput(out);
    expect(parsed.publicKey.startsWith("age1")).toBe(true);
    expect(parsed.secretKey.startsWith("AGE-SECRET-KEY-")).toBe(true);
    expect(parsed.fileText.endsWith("\n")).toBe(true);
  });

  it("parses partial key file", () => {
    const out = "# public key: age1abc\n";
    expect(parseAgeKeyFile(out).publicKey).toBe("age1abc");
  });

  it("throws on invalid output", () => {
    expect(() => parseAgeKeygenOutput("nope")).toThrow(/failed to parse/);
  });
});

