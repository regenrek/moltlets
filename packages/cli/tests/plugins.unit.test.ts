import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { baseCommandNames } from "../src/commands/registry.js";
import {
  installPlugin,
  listInstalledPlugins,
  listReservedCommands,
  loadPluginCommand,
  removePlugin,
} from "../src/lib/plugins.js";

describe("plugins reserved commands", () => {
  it("matches base command registry", () => {
    const reserved = listReservedCommands().sort();
    const base = [...baseCommandNames].sort();
    expect(reserved).toEqual(base);
  });

  it("skips broken plugin manifests", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-plugins-"));
    const pluginsDir = path.join(repoRoot, ".clawlets", "plugins");
    const goodDir = path.join(pluginsDir, "cattle");
    const badDir = path.join(pluginsDir, "broken");
    fs.mkdirSync(goodDir, { recursive: true });
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(
      path.join(goodDir, "clawlets-plugin.json"),
      JSON.stringify(
        {
          slug: "cattle",
          packageName: "@clawlets/plugin-cattle",
          version: "0.1.0",
          command: "cattle",
          entry: "./dist/plugin.mjs",
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(badDir, "clawlets-plugin.json"), "{\"bad\":");
    const errors: { slug: string }[] = [];
    const plugins = listInstalledPlugins({ cwd: repoRoot, onError: (err) => errors.push(err) });
    expect(plugins.map((p) => p.command)).toEqual(["cattle"]);
    expect(errors.map((e) => e.slug).sort()).toEqual(["broken"]);
  });

  it("rejects path traversal in removePlugin", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-plugins-"));
    fs.mkdirSync(path.join(repoRoot, ".clawlets", "plugins"), { recursive: true });
    const rmSpy = vi.spyOn(fs, "rmSync");
    expect(() => removePlugin({ cwd: repoRoot, slug: "../.." })).toThrow(/invalid plugin command|escapes/);
    expect(rmSpy).not.toHaveBeenCalled();
    rmSpy.mockRestore();
  });

  it("rejects plugin entry path traversal", async () => {
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-plugin-"));
    const base = {
      slug: "cattle",
      packageName: "@clawlets/plugin-cattle",
      version: "0.1.0",
      command: "cattle",
      installDir: "/tmp/ignore",
      packageDir: pkgDir,
    };
    await expect(
      loadPluginCommand({ ...base, entry: "../evil.mjs" }),
    ).rejects.toThrow(/entry must not contain \.\./i);
    await expect(
      loadPluginCommand({ ...base, entry: path.resolve(pkgDir, "abs.mjs") }),
    ).rejects.toThrow(/must be relative/i);
  });

  it("rejects third-party plugins without override", async () => {
    const { plugin } = await import("../src/commands/platform/plugin.js");
    const add = (plugin as any).subCommands?.add;
    await expect(
      add.run({ args: { name: "evil", package: "evil/plugin", allowThirdParty: false } }),
    ).rejects.toThrow(/third-party plugins disabled/i);
  });

  it("skips invalid package names", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-plugins-"));
    const pluginsDir = path.join(repoRoot, ".clawlets", "plugins");
    const badDir = path.join(pluginsDir, "invalid");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(
      path.join(badDir, "clawlets-plugin.json"),
      JSON.stringify(
        {
          slug: "invalid",
          packageName: "@@bad/name",
          version: "0.1.0",
          command: "invalid",
          entry: "./dist/plugin.mjs",
        },
        null,
        2,
      ),
    );
    const errors: { slug: string }[] = [];
    const plugins = listInstalledPlugins({ cwd: repoRoot, onError: (err) => errors.push(err) });
    expect(plugins).toEqual([]);
    expect(errors.map((e) => e.slug)).toEqual(["invalid"]);
  });

  it("rejects reserved command slugs on install", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-plugins-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");
    await expect(
      installPlugin({ cwd: repoRoot, slug: "doctor", packageName: "@clawlets/plugin-doctor" }),
    ).rejects.toThrow(/reserved/);
  });
});
