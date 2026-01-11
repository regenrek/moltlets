import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateHostSecretsYamlFiles } from "../src/lib/secrets-policy";

describe("secrets-policy", () => {
  it("fails when secrets dir is missing", () => {
    const r = validateHostSecretsYamlFiles({ secretsDir: "/definitely/missing" });
    expect(r.ok).toBe(false);
    expect(r.violations[0]?.message).toMatch(/missing secrets dir/i);
  });

  it("fails when secrets path is not a directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawdlets-secrets-policy-"));
    const file = path.join(root, "not-a-dir");
    await writeFile(file, "x", "utf8");
    const r = validateHostSecretsYamlFiles({ secretsDir: file });
    expect(r.ok).toBe(false);
    expect(r.violations[0]?.message).toMatch(/not a directory/i);
  });

  it("validates individual secret files by filename key + sops metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "clawdlets-secrets-policy-"));
    await writeFile(path.join(dir, "ignore.txt"), "x", "utf8");

    await writeFile(path.join(dir, "bad.yaml"), "a: [", "utf8");
    await writeFile(path.join(dir, "not-object.yaml"), "foo\n", "utf8");
    await writeFile(path.join(dir, "two-keys.yaml"), "a: 1\nb: 2\nsops: {}\n", "utf8");
    await writeFile(path.join(dir, "mismatch.yaml"), "other: 1\nsops: {}\n", "utf8");
    await writeFile(path.join(dir, "missing-sops.yaml"), "missing-sops: 1\n", "utf8");

    const r = validateHostSecretsYamlFiles({ secretsDir: dir });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.message.includes("invalid YAML"))).toBe(true);
    expect(r.violations.some((v) => v.message.includes("expected YAML mapping"))).toBe(true);
    expect(r.violations.some((v) => v.message.includes("expected exactly 1 secret key"))).toBe(true);
    expect(r.violations.some((v) => v.message.includes("must match filename"))).toBe(true);
    expect(r.violations.some((v) => v.message.includes("missing sops metadata"))).toBe(true);
  });

  it("accepts one-key + sops metadata per file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "clawdlets-secrets-policy-"));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "discord_token_alpha.yaml"), "discord_token_alpha: x\nsops: {}\n", "utf8");
    const r = validateHostSecretsYamlFiles({ secretsDir: dir });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
});
