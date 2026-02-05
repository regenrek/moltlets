import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateDocsIndexIntegrity } from "../src/lib/docs-index";

function docsDir(repoRoot: string) {
  return path.join(repoRoot, "apps", "docs", "content", "docs");
}

describe("docs index integrity", () => {
  it("validates apps/docs/content/docs/meta.json in the repo", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r).toEqual({ ok: true, errors: [] });
  });

  it("reports missing repo docs meta", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-docs-index-"));
    await mkdir(docsDir(repoRoot), { recursive: true });
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("missing docs meta"))).toBe(true);
  });

  it("skips validation when docs dir is absent", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-docs-index-"));
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r).toEqual({ ok: true, errors: [] });
  });

  it("rejects invalid meta JSON", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-docs-index-"));
    await mkdir(docsDir(repoRoot), { recursive: true });
    await writeFile(path.join(docsDir(repoRoot), "meta.json"), "not-json", "utf8");
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("docs meta must be valid JSON"))).toBe(true);
  });

  it("reports duplicates and missing referenced pages", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-docs-index-"));
    const dir = docsDir(repoRoot);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "meta.json"), JSON.stringify({ pages: ["missing", "missing"] }), "utf8");
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("duplicate page"))).toBe(true);
    expect(r.errors.some((e) => e.includes("references missing page"))).toBe(true);
  });

  it("reports directory pages missing index or meta", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-docs-index-"));
    const dir = docsDir(repoRoot);
    await mkdir(dir, { recursive: true });
    await mkdir(path.join(dir, "section"), { recursive: true });
    await writeFile(path.join(dir, "meta.json"), JSON.stringify({ pages: ["section"] }), "utf8");
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("dir without index.mdx"))).toBe(true);
    expect(r.errors.some((e) => e.includes("dir without meta.json"))).toBe(true);
  });

  it("rejects unsafe page paths", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-docs-index-"));
    const dir = docsDir(repoRoot);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "meta.json"), JSON.stringify({ pages: ["../escape"] }), "utf8");
    const r = validateDocsIndexIntegrity({ repoRoot });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("safe relative path"))).toBe(true);
  });
});
