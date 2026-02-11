import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const scriptPath = path.join(repoRoot, "scripts", "dev-install-clawlets-wrapper.sh");
const managedBlockBegin = "# >>> clawlets PATH >>>";
const managedBlockEnd = "# <<< clawlets PATH <<<";
const tempDirs: string[] = [];

function makeTempHome(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clawlets-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function writeFakePnpm(binDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  const pnpmPath = path.join(binDir, "pnpm");
  fs.writeFileSync(
    pnpmPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [[ \"${1-}\" != \"-C\" ]]; then",
      "  echo \"unexpected pnpm invocation\" >&2",
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(pnpmPath, 0o755);
}

function runInstaller(homeDir: string, args: string[] = []): ReturnType<typeof spawnSync> {
  const fakeBin = path.join(homeDir, "fake-bin");
  writeFakePnpm(fakeBin);
  const env = {
    ...process.env,
    HOME: homeDir,
    SHELL: "/bin/zsh",
    CLAWLETS_BIN_DIR: path.join(homeDir, "bin"),
    CLAWLETS_PATH_SHELLS: "",
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function occurrences(text: string, needle: string): number {
  if (!text) return 0;
  return text.split(needle).length - 1;
}

describe("dev-install-clawlets-wrapper.sh", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs wrapper and persists PATH for zsh targets", () => {
    const home = makeTempHome("wrapper-zsh");
    const result = runInstaller(home, ["--path-shells", "zsh"]);
    expect(result.status).toBe(0);

    const wrapperPath = path.join(home, "bin", "clawlets");
    expect(fs.existsSync(wrapperPath)).toBe(true);
    expect(fs.readFileSync(wrapperPath, "utf8")).toContain("packages/cli/dist/main.mjs");
    expect((fs.statSync(wrapperPath).mode & 0o111) !== 0).toBe(true);

    const zshrc = path.join(home, ".zshrc");
    const zprofile = path.join(home, ".zprofile");
    expect(fs.existsSync(zshrc)).toBe(true);
    expect(fs.existsSync(zprofile)).toBe(true);

    const zshrcBody = fs.readFileSync(zshrc, "utf8");
    const zprofileBody = fs.readFileSync(zprofile, "utf8");
    expect(zshrcBody).toContain(managedBlockBegin);
    expect(zshrcBody).toContain(path.join(home, "bin"));
    expect(zprofileBody).toContain(managedBlockEnd);
  });

  it("supports dry-run without writing wrapper or profile files", () => {
    const home = makeTempHome("wrapper-dry-run");
    const result = runInstaller(home, ["--dry-run", "--path-shells", "zsh,bash"]);
    expect(result.status).toBe(0);

    expect(fs.existsSync(path.join(home, "bin", "clawlets"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".zshrc"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".bashrc"))).toBe(false);
    expect(String(result.stdout)).toContain("dry-run:");
  });

  it("supports no-path-edit mode", () => {
    const home = makeTempHome("wrapper-no-path");
    const result = runInstaller(home, ["--no-path-edit", "--path-shells", "zsh,bash"]);
    expect(result.status).toBe(0);

    expect(fs.existsSync(path.join(home, "bin", "clawlets"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".zshrc"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".bashrc"))).toBe(false);
    expect(String(result.stdout)).toContain("PATH updates disabled");
  });

  it("updates managed blocks idempotently", () => {
    const home = makeTempHome("wrapper-idempotent");
    const first = runInstaller(home, ["--path-shells", "zsh"]);
    const second = runInstaller(home, ["--path-shells", "zsh"]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    const zshrcBody = fs.readFileSync(path.join(home, ".zshrc"), "utf8");
    expect(occurrences(zshrcBody, managedBlockBegin)).toBe(1);
    expect(occurrences(zshrcBody, managedBlockEnd)).toBe(1);
  });

  it("fails fast on unsupported path shell value", () => {
    const home = makeTempHome("wrapper-invalid");
    const result = runInstaller(home, ["--path-shells", "zsh,unknown"]);
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain("unsupported shell in --path-shells: unknown");
  });
});
