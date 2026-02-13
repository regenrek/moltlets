import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import process from "node:process";
import { resolveNixBin } from "@clawlets/core/lib/nix/nix-bin";
import { capture, run } from "@clawlets/core/lib/runtime/run";
import { confirmOrAbort, printHuman } from "./shared";
import type { InstallNixMode, NixEnsureResult } from "./types";

const DETERMINATE_NIX_INSTALLER_VERSION = "v3.15.2";

const DETERMINATE_INSTALLER_ASSET_BY_PLATFORM_ARCH: Record<string, { assetName: string; sha256: string }> = {
  "darwin-arm64": {
    assetName: "nix-installer-aarch64-darwin",
    sha256: "b4dd473e3665db0d84d219cf22cc12b2b13d6f1c228c8b2d395820ca01be56a0",
  },
  "linux-arm64": {
    assetName: "nix-installer-aarch64-linux",
    sha256: "97cad8e8975327eb24ed1158deaf6b475145b665c597b19f441e8438605014fb",
  },
  "linux-x64": {
    assetName: "nix-installer-x86_64-linux",
    sha256: "dfc15179d7f46cf4a604e3a9bb6e986d78b6fee4620c4e418673e43c649640de",
  },
};

function installNixInstructions(): string {
  return [
    "Install Nix (Determinate installer):",
    `  https://github.com/DeterminateSystems/nix-installer/releases/tag/${DETERMINATE_NIX_INSTALLER_VERSION}`,
    "Then set NIX_BIN if needed (example):",
    "  NIX_BIN=/nix/var/nix/profiles/default/bin/nix",
  ].join("\n");
}

async function nixVersion(nixBin: string): Promise<string> {
  const out = await capture(nixBin, ["--version"], {
    stdin: "ignore",
    maxOutputBytes: 8 * 1024,
  });
  return out.trim();
}

function resolveInstallerAsset(): {
  assetName: string;
  sha256: string;
  url: string;
} {
  const key = `${os.platform()}-${os.arch()}`;
  const asset = DETERMINATE_INSTALLER_ASSET_BY_PLATFORM_ARCH[key];
  if (!asset) {
    throw new Error(
      [
        `automatic Nix install is unsupported on ${os.platform()}/${os.arch()}`,
        installNixInstructions(),
      ].join("\n"),
    );
  }
  return {
    ...asset,
    url: `https://github.com/DeterminateSystems/nix-installer/releases/download/${DETERMINATE_NIX_INSTALLER_VERSION}/${asset.assetName}`,
  };
}

async function verifySha256(filePath: string, expectedSha256: string): Promise<void> {
  const file = await fs.readFile(filePath);
  const digest = createHash("sha256").update(file).digest("hex");
  if (digest !== expectedSha256) {
    throw new Error(
      `nix installer checksum mismatch (expected ${expectedSha256}, got ${digest})`,
    );
  }
}

async function installDeterminateNixBinary(): Promise<void> {
  const asset = resolveInstallerAsset();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-nix-installer-"));
  const binaryPath = path.join(tempDir, asset.assetName);
  try {
    await run("curl", [
      "--fail",
      "--show-error",
      "--silent",
      "--location",
      "--proto",
      "=https",
      "--tlsv1.2",
      "--output",
      binaryPath,
      asset.url,
    ], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "inherit",
    });
    await verifySha256(binaryPath, asset.sha256);
    await fs.chmod(binaryPath, 0o755);
    await run(binaryPath, ["install", "--no-confirm"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function ensureNix(params: {
  installMode: InstallNixMode;
  confirm: boolean;
  json: boolean;
  explicitNixBin?: string;
}): Promise<NixEnsureResult> {
  const explicitNixBin = String(params.explicitNixBin || "").trim();
  if (explicitNixBin) {
    const resolved = resolveNixBin({ env: process.env, nixBin: explicitNixBin });
    if (!resolved) {
      throw new Error(`--nix-bin not executable: ${explicitNixBin}`);
    }
    process.env.NIX_BIN = resolved;
  }

  const discovered = resolveNixBin({ env: process.env, nixBin: explicitNixBin || undefined });
  if (discovered && params.installMode !== "always") {
    process.env.NIX_BIN = discovered;
    return {
      status: "already_installed",
      nixBin: discovered,
      version: await nixVersion(discovered),
    };
  }

  if (params.installMode === "never") {
    throw new Error(`nix not found (install Nix first)\n${installNixInstructions()}`);
  }

  await confirmOrAbort({
    confirm: params.confirm,
    message: "Nix is missing. Install Determinate Nix now? (requires admin privileges)",
    initialValue: true,
  });

  printHuman(params.json, "step: installing nix (determinate)");
  await installDeterminateNixBinary();

  await run(
    "bash",
    [
      "-lc",
      ". /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh && nix --version",
    ],
    {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const resolved = resolveNixBin({ env: process.env, nixBin: explicitNixBin || undefined });
  if (!resolved) {
    throw new Error(`nix install completed but nix is still not discoverable\n${installNixInstructions()}`);
  }
  process.env.NIX_BIN = resolved;
  return {
    status: "installed",
    nixBin: resolved,
    version: await nixVersion(resolved),
  };
}

export async function ensurePnpmInstall(params: {
  repoRoot: string;
  json: boolean;
}): Promise<void> {
  printHuman(params.json, "step: enabling corepack");
  await run("corepack", ["enable"], {
    cwd: params.repoRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  printHuman(params.json, "step: installing workspace dependencies");
  await run("pnpm", ["install", "--frozen-lockfile"], {
    cwd: params.repoRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
}
