import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { initProject } from "../src/lib/project/project-init";

describe("project init", () => {
  it("creates expected file tree from local template spec", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "clawlets-project-init-"));
    try {
      const destDir = path.join(tempRoot, "my-project");
      const templateDir = path.join(__dirname, ".template");
      const res = await initProject({
        destDir,
        host: "my-host",
        templateSpec: `file:${templateDir}`,
        gitInit: false,
      });

      expect(res.destDir).toBe(destDir);
      expect(res.host).toBe("my-host");
      expect(res.gitInitialized).toBe(false);
      expect(res.plannedFiles).toContain("fleet/clawlets.json");

      expect(fs.existsSync(path.join(destDir, "fleet", "clawlets.json"))).toBe(true);
      expect(fs.existsSync(path.join(destDir, ".gitignore"))).toBe(true);
      expect(fs.existsSync(path.join(destDir, "_gitignore"))).toBe(false);

      const cfg = JSON.parse(await readFile(path.join(destDir, "fleet", "clawlets.json"), "utf8")) as any;
      expect(cfg.defaultHost).toBe("my-host");
      expect(cfg.hosts?.["my-host"]).toBeTruthy();
      expect(cfg.hosts?.["openclaw-fleet-host"]).toBeUndefined();

      const readme = await readFile(path.join(destDir, "README.md"), "utf8");
      expect(readme.split("\n")[0]).toBe("# my-project");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes host theme when provided", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "clawlets-project-init-"));
    try {
      const destDir = path.join(tempRoot, "my-project");
      const templateDir = path.join(__dirname, ".template");
      await initProject({
        destDir,
        host: "my-host",
        templateSpec: `file:${templateDir}`,
        gitInit: false,
        theme: { emoji: "🚀", color: "emerald" },
      });

      const cfg = JSON.parse(await readFile(path.join(destDir, "fleet", "clawlets.json"), "utf8")) as any;
      expect(cfg.hosts?.["my-host"]?.theme).toEqual({ emoji: "🚀", color: "emerald" });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("replaces __CLAWLETS_REF__ placeholder in template flake input", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "clawlets-project-init-"));
    try {
      const destDir = path.join(tempRoot, "my-project");
      const sourceTemplateDir = path.join(__dirname, ".template");
      const placeholderTemplateDir = path.join(tempRoot, "template-with-ref-placeholder");
      await cp(sourceTemplateDir, placeholderTemplateDir, { recursive: true });

      const placeholderFlakePath = path.join(placeholderTemplateDir, "flake.nix");
      const placeholderFlake = (await readFile(placeholderFlakePath, "utf8")).replace(
        /clawlets\.url = "github:regenrek\/clawlets(?:\/[^"]+)?";/,
        'clawlets.url = "github:regenrek/clawlets/__CLAWLETS_REF__";',
      );
      await writeFile(placeholderFlakePath, placeholderFlake, "utf8");

      await initProject({
        destDir,
        host: "my-host",
        templateSpec: `file:${placeholderTemplateDir}`,
        templateRef: "deadbeef",
        gitInit: false,
      });

      const generatedFlake = await readFile(path.join(destDir, "flake.nix"), "utf8");
      expect(generatedFlake).toContain('clawlets.url = "github:regenrek/clawlets/deadbeef";');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
