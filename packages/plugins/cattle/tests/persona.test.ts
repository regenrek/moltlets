import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, it, expect, vi } from "vitest";

describe("cattle persona command", () => {
  it("persona add creates a skeleton", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-cli-persona-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");

    const prev = process.cwd();
    try {
      process.chdir(repoRoot);
      const { cattlePersona } = await import("../src/commands/cattle/persona");
      await cattlePersona.subCommands.add.run({ args: { name: "rex" } as any });
    } finally {
      process.chdir(prev);
    }

    expect(fs.existsSync(path.join(repoRoot, "cattle", "personas", "rex", "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "cattle", "personas", "rex", "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "cattle", "personas", "rex", "skills"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "cattle", "personas", "rex", "memory"))).toBe(true);
  });

  it("persona add dry-run prints plan without writing", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-cli-persona-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    const prev = process.cwd();
    try {
      process.chdir(repoRoot);
      const { cattlePersona } = await import("../src/commands/cattle/persona");
      await cattlePersona.subCommands.add.run({ args: { name: "rex", dryRun: true } as any });
    } finally {
      process.chdir(prev);
      logSpy.mockRestore();
    }

    expect(logs.join("\n")).toMatch(/planned: cattle\/personas\/rex\/SOUL.md/);
    expect(fs.existsSync(path.join(repoRoot, "cattle", "personas", "rex"))).toBe(false);
  });

  it("persona add enforces overwrite unless forced", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-cli-persona-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");

    const prev = process.cwd();
    try {
      process.chdir(repoRoot);
      const { cattlePersona } = await import("../src/commands/cattle/persona");
      await cattlePersona.subCommands.add.run({ args: { name: "rex" } as any });
      await expect(cattlePersona.subCommands.add.run({ args: { name: "rex" } as any })).rejects.toThrow(/already exists/);
      await expect(cattlePersona.subCommands.add.run({ args: { name: "rex", force: true } as any })).resolves.toBeUndefined();
    } finally {
      process.chdir(prev);
    }
  });

  it("persona list filters invalid names", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-cli-persona-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");

    fs.mkdirSync(path.join(repoRoot, "cattle", "personas", "rex"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "cattle", "personas", "Bad Name"), { recursive: true });

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    const prev = process.cwd();
    try {
      process.chdir(repoRoot);
      const { cattlePersona } = await import("../src/commands/cattle/persona");
      await cattlePersona.subCommands.list.run({ args: { json: true } as any });
    } finally {
      process.chdir(prev);
      logSpy.mockRestore();
    }

    const obj = JSON.parse(logs.join("\n"));
    expect(obj.personas).toEqual(["rex"]);
  });
});
