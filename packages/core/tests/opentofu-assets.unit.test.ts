import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ProvisionerRuntime } from "../src/lib/infra/types.js";
import { resolveBundledOpenTofuAssetDir } from "../src/lib/infra/opentofu-assets.js";

function runtime(repoRoot: string): ProvisionerRuntime {
  return {
    repoRoot,
    opentofuDir: path.join(repoRoot, ".clawlets", "infra", "opentofu"),
    nixBin: "nix",
    dryRun: true,
    redact: [],
    credentials: {},
  };
}

describe("resolveBundledOpenTofuAssetDir", () => {
  it("resolves bundled CLI dist assets relative to module URL", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawlets-opentofu-assets-"));
    try {
      const mainFile = path.join(root, "runtime", "dist", "main.mjs");
      const assetsDir = path.join(root, "runtime", "dist", "assets", "opentofu", "providers", "hetzner");
      await mkdir(path.dirname(mainFile), { recursive: true });
      await writeFile(mainFile, "// test", "utf8");
      await mkdir(assetsDir, { recursive: true });

      const resolved = resolveBundledOpenTofuAssetDir({
        provider: "hetzner",
        runtime: runtime(path.join(root, "project")),
        moduleUrl: pathToFileURL(mainFile).href,
      });

      expect(resolved).toBe(assetsDir);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to repo-root source assets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawlets-opentofu-assets-"));
    try {
      const repoRoot = path.join(root, "project");
      const moduleFile = path.join(root, "runtime", "worker.mjs");
      const assetsDir = path.join(repoRoot, "packages", "core", "src", "assets", "opentofu", "providers", "aws");
      await mkdir(path.dirname(moduleFile), { recursive: true });
      await writeFile(moduleFile, "// test", "utf8");
      await mkdir(assetsDir, { recursive: true });

      const resolved = resolveBundledOpenTofuAssetDir({
        provider: "aws",
        runtime: runtime(repoRoot),
        moduleUrl: pathToFileURL(moduleFile).href,
      });

      expect(resolved).toBe(assetsDir);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("throws with candidate paths when assets are missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawlets-opentofu-assets-"));
    try {
      const moduleFile = path.join(root, "runtime", "worker.mjs");
      await mkdir(path.dirname(moduleFile), { recursive: true });
      await writeFile(moduleFile, "// test", "utf8");

      expect(() =>
        resolveBundledOpenTofuAssetDir({
          provider: "hetzner",
          runtime: runtime(path.join(root, "project")),
          moduleUrl: pathToFileURL(moduleFile).href,
        }),
      ).toThrow(/missing bundled hetzner OpenTofu assets:/i);
      expect(() =>
        resolveBundledOpenTofuAssetDir({
          provider: "hetzner",
          runtime: runtime(path.join(root, "project")),
          moduleUrl: pathToFileURL(moduleFile).href,
        }),
      ).toThrow(/assets[\/\\]opentofu[\/\\]providers[\/\\]hetzner/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
