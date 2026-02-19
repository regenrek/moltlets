import { getRepoLayout } from "./repo-layout.js";
import { findRepoRoot } from "./lib/project/repo.js";
import {
  loadDeployCreds,
} from "./lib/infra/deploy-creds.js";
import { addRepoChecks } from "./doctor/repo-checks.js";
import { addDeployChecks } from "./doctor/deploy-checks.js";
import type { DoctorCheck } from "./doctor/types.js";

export type { DoctorCheck } from "./doctor/types.js";

export async function collectDoctorChecks(params: {
  cwd: string;
  runtimeDir?: string;
  envFile?: string;
  host: string;
  scope?: "repo" | "bootstrap" | "updates" | "all";
  skipGithubTokenCheck?: boolean;
}): Promise<DoctorCheck[]> {
  const deployCreds = loadDeployCreds({ cwd: params.cwd, runtimeDir: params.runtimeDir, envFile: params.envFile });

  const repoRoot = findRepoRoot(params.cwd);
  const layout = getRepoLayout(repoRoot, params.runtimeDir);

  const wantRepo = params.scope === "repo" || params.scope === "all" || params.scope == null;
  const wantBootstrap = params.scope === "bootstrap" || params.scope === "all" || params.scope == null;
  const wantUpdates = params.scope === "updates" || params.scope === "all" || params.scope == null;

  const checks: DoctorCheck[] = [];
  const push = (c: DoctorCheck) => {
    if (c.scope === "repo" && !wantRepo) return;
    if (c.scope === "bootstrap" && !wantBootstrap) return;
    if (c.scope === "updates" && !wantUpdates) return;
    checks.push(c);
  };

  const HCLOUD_TOKEN = deployCreds.values.HCLOUD_TOKEN;
  const NIX_BIN = deployCreds.values.NIX_BIN || "nix";
  const GITHUB_TOKEN = deployCreds.values.GITHUB_TOKEN;
  const SOPS_AGE_KEY_FILE = deployCreds.values.SOPS_AGE_KEY_FILE;

  const host = params.host.trim() || "openclaw-fleet-host";

  let fleetGateways: string[] | null = null;
  if (wantRepo) {
    const repoResult = await addRepoChecks({
      repoRoot,
      layout,
      host,
      nixBin: NIX_BIN,
      push,
    });
    fleetGateways = repoResult.fleetGateways;
  }

  if (wantBootstrap && deployCreds.envFile && deployCreds.envFile.status !== "ok") {
    const detail = deployCreds.envFile.error ? `${deployCreds.envFile.path} (${deployCreds.envFile.error})` : deployCreds.envFile.path;
    push({ scope: "bootstrap", status: "missing", label: "deploy env file", detail });
  }

  if (wantBootstrap) {
    await addDeployChecks({
      cwd: params.cwd,
      repoRoot,
      layout,
      host,
      nixBin: NIX_BIN,
      hcloudToken: HCLOUD_TOKEN,
      sopsAgeKeyFile: SOPS_AGE_KEY_FILE,
      githubToken: GITHUB_TOKEN,
      fleetGateways,
      push,
      skipGithubTokenCheck: params.skipGithubTokenCheck,
      scope: "bootstrap",
    });
  }

  if (wantUpdates) {
    await addDeployChecks({
      cwd: params.cwd,
      repoRoot,
      layout,
      host,
      nixBin: NIX_BIN,
      hcloudToken: HCLOUD_TOKEN,
      sopsAgeKeyFile: SOPS_AGE_KEY_FILE,
      githubToken: GITHUB_TOKEN,
      fleetGateways,
      push,
      skipGithubTokenCheck: params.skipGithubTokenCheck,
      scope: "updates",
    });
  }

  return checks;
}
