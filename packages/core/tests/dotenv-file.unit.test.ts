import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import { formatDotenvValue, redactDotenv, upsertDotenv } from "../src/lib/storage/dotenv-file";

describe("dotenv-file", () => {
  it("upserts existing keys and appends missing keys", () => {
    const input = ["FOO=bar", "BAZ=1", ""].join("\n");
    const out = upsertDotenv(input, {
      FOO: "next",
      NEW: "hello world",
    });
    expect(out).toContain("FOO=next\n");
    expect(out).toContain('NEW="hello world"\n');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("does not add a leading newline for an empty file", () => {
    const out = upsertDotenv("", { A: "1" });
    expect(out).toBe("A=1\n");
  });

  it("normalizes trailing newlines when only updating existing keys", () => {
    const input = ["FOO=bar", "", ""].join("\n");
    const out = upsertDotenv(input, { FOO: "baz" });
    expect(out).toBe("FOO=baz\n");
  });

  it("formats dotenv values with quoting only when needed", () => {
    expect(formatDotenvValue("")).toBe("");
    expect(formatDotenvValue("plain")).toBe("plain");
    expect(formatDotenvValue("has space")).toBe('"has space"');
    expect(formatDotenvValue("has$sign")).toBe('"has$sign"');
    expect(formatDotenvValue('{"x":1}')).toBe('{"x":1}');
    const jsonWithSpace = '{"label":"a b"}';
    expect(dotenv.parse(`K=${formatDotenvValue(jsonWithSpace)}\n`).K).toBe(jsonWithSpace);
    const jsonWithHash = '{"label":"a#b"}';
    expect(dotenv.parse(`K=${formatDotenvValue(jsonWithHash)}\n`).K).toBe(jsonWithHash);
  });

  it("redacts selected keys", () => {
    const input = ["HCLOUD_TOKEN=abc", 'GITHUB_TOKEN="def"', "OK=1", ""].join(
      "\n",
    );
    const out = redactDotenv(input, ["HCLOUD_TOKEN", "GITHUB_TOKEN"]);
    expect(out).toContain('HCLOUD_TOKEN="***REDACTED***"');
    expect(out).toContain('GITHUB_TOKEN="***REDACTED***"');
    expect(out).toContain("OK=1");
  });
});
