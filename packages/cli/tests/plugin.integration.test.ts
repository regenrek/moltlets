import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

async function waitForFile(filePath: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout waiting for file: ${filePath}`);
}

describe("plugin dispatch integration", () => {
  const prevCwd = process.cwd();
  const prevArgv = process.argv.slice();
  const tempDirs: string[] = [];

  afterEach(() => {
    process.chdir(prevCwd);
    process.argv = prevArgv.slice();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dispatches installed plugin via runtime dir", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-plugin-it-"));
    tempDirs.push(repoRoot);
    writeFile(path.join(repoRoot, "flake.nix"), "{ }\n");
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });

    const runtimeDir = ".clawlets";
    const pluginInstallDir = path.join(repoRoot, runtimeDir, "plugins", "cattle");
    const pluginPackageDir = path.join(
      pluginInstallDir,
      "node_modules",
      "@clawlets",
      "plugin-cattle",
    );
    writeFile(
      path.join(pluginInstallDir, "clawlets-plugin.json"),
      JSON.stringify(
        {
          slug: "cattle",
          packageName: "@clawlets/plugin-cattle",
          version: "0.0.0",
          command: "cattle",
          entry: "./dist/plugin.mjs",
        },
        null,
        2,
      ),
    );
    writeFile(
      path.join(pluginPackageDir, "package.json"),
      JSON.stringify({ name: "@clawlets/plugin-cattle", version: "0.0.0", type: "module" }, null, 2),
    );
    const outPath = path.join(repoRoot, "plugin-out.json");
    writeFile(
      path.join(pluginPackageDir, "dist", "plugin.mjs"),
      [
        "import fs from \"node:fs\";",
        "import path from \"node:path\";",
        "export const command = {",
        "  meta: { name: \"cattle\" },",
        "  args: { foo: { type: \"string\" } },",
        "  async run({ args }) {",
        "    const payload = { ok: true, foo: String(args.foo || \"\") };",
        "    const out = path.join(process.cwd(), \"plugin-out.json\");",
        "    fs.writeFileSync(out, JSON.stringify(payload));",
        "  },",
        "};",
      ].join("\n"),
    );

    process.chdir(repoRoot);
    process.argv = ["node", "clawlets", `--runtime-dir=${runtimeDir}`, "cattle", "--foo", "bar"];
    vi.resetModules();
    await import("../src/main.ts");

    await waitForFile(outPath);
    const obj = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(obj).toEqual({ ok: true, foo: "bar" });
  });
});
