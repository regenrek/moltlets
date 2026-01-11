import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { getRepoLayout } from "./repo-layout.js";
import { expandPath } from "./lib/path-expand.js";
import { findRepoRoot } from "./lib/repo.js";
import { getStackLayout } from "./stack.js";
import { addRepoChecks } from "./doctor/repo-checks.js";
import { addDeployChecks } from "./doctor/deploy-checks.js";
import type { DoctorCheck } from "./doctor/types.js";

export type { DoctorCheck } from "./doctor/types.js";

export async function collectDoctorChecks(params: {
  cwd: string;
  stackDir?: string;
  envFile?: string;
  host: string;
  scope?: "repo" | "deploy" | "all";
}): Promise<DoctorCheck[]> {
  const repoRoot = findRepoRoot(params.cwd);
  const stackLayout = getStackLayout({ cwd: params.cwd, stackDir: params.stackDir });
  const layout = getRepoLayout(repoRoot, stackLayout.stackDir);

  const wantRepo = params.scope === "repo" || params.scope === "all" || params.scope == null;
  const wantDeploy = params.scope === "deploy" || params.scope === "all" || params.scope == null;

  const checks: DoctorCheck[] = [];
  const push = (c: DoctorCheck) => {
    if (c.scope === "repo" && !wantRepo) return;
    if (c.scope === "deploy" && !wantDeploy) return;
    checks.push(c);
  };

  const resolvedEnvFile = params.envFile
    ? path.resolve(params.cwd, params.envFile)
    : fs.existsSync(stackLayout.envFile)
      ? stackLayout.envFile
      : undefined;

  const envFromFile =
    resolvedEnvFile && fs.existsSync(resolvedEnvFile)
      ? dotenv.parse(fs.readFileSync(resolvedEnvFile, "utf8"))
      : {};

  const getEnv = (k: string): string | undefined => {
    const v = process.env[k] ?? envFromFile[k];
    const trimmed = String(v ?? "").trim();
    return trimmed ? trimmed : undefined;
  };

  const HCLOUD_TOKEN = getEnv("HCLOUD_TOKEN");
  const NIX_BIN = getEnv("NIX_BIN") || "nix";
  const GITHUB_TOKEN = getEnv("GITHUB_TOKEN");
  const SOPS_AGE_KEY_FILE_RAW = getEnv("SOPS_AGE_KEY_FILE");
  const SOPS_AGE_KEY_FILE = SOPS_AGE_KEY_FILE_RAW ? expandPath(SOPS_AGE_KEY_FILE_RAW) : undefined;

  const host = params.host.trim() || "clawdbot-fleet-host";

  const repoResult = await addRepoChecks({
    repoRoot,
    layout,
    host,
    nixBin: NIX_BIN,
    push,
  });

  if (wantDeploy) {
    await addDeployChecks({
      cwd: params.cwd,
      repoRoot,
      layout,
      stackLayout,
      host,
      nixBin: NIX_BIN,
      resolvedEnvFile,
      hcloudToken: HCLOUD_TOKEN,
      sopsAgeKeyFile: SOPS_AGE_KEY_FILE,
      githubToken: GITHUB_TOKEN,
      fleetBots: repoResult.fleetBots,
      push,
    });
  }

  return checks;
}
