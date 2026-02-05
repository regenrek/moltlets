import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_TIMEOUT_MS = 15_000;
import { plugin } from "../src/commands/platform/plugin.js";

function makeRepoRoot(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-plugin-cmd-"));
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "flake.nix"), "{ }\n", "utf8");
  return repoRoot;
}

describe("plugin command", () => {
  const prevCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(() => {
    process.chdir(prevCwd);
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    "list --json returns empty arrays when no plugins",
    async () => {
    const repoRoot = makeRepoRoot();
    tempDirs.push(repoRoot);
    process.chdir(repoRoot);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    await plugin.subCommands.list.run({ args: { json: true } as any });
    logSpy.mockRestore();
    const obj = JSON.parse(logs.join("\n"));
    expect(obj.plugins).toEqual([]);
    expect(obj.errors).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list prints empty message when no plugins",
    async () => {
    const repoRoot = makeRepoRoot();
    tempDirs.push(repoRoot);
    process.chdir(repoRoot);
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    await plugin.subCommands.list.run({ args: { json: false } as any });
    logSpy.mockRestore();
    expect(logs.join("\n")).toMatch(/no plugins installed/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list warns on broken plugins",
    async () => {
    const repoRoot = makeRepoRoot();
    tempDirs.push(repoRoot);
    process.chdir(repoRoot);
    const badDir = path.join(repoRoot, ".clawlets", "plugins", "broken");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "clawlets-plugin.json"), "{\"bad\":");
    const errors: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args.join(" ")));
    await plugin.subCommands.list.run({ args: { json: false } as any });
    errSpy.mockRestore();
    expect(errors.join("\n")).toMatch(/skipping plugin broken/);
    },
    TEST_TIMEOUT_MS,
  );
});
