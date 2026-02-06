import { findRepoRoot } from "../project/repo.js";
import { loadClawletsConfig, type ClawletsConfig, type ClawletsHostConfig } from "../config/index.js";
import type { RepoLayout } from "../../repo-layout.js";
import { resolveHostNameOrExit } from "../host/host-resolve.js";

export type RepoContext = {
  repoRoot: string;
  layout: RepoLayout;
  config: ClawletsConfig;
};

export type HostContext = RepoContext & {
  hostName: string;
  hostCfg: ClawletsHostConfig;
};

export function loadRepoContext(params: { cwd: string; runtimeDir?: string }): RepoContext {
  const repoRoot = findRepoRoot(params.cwd);
  const { layout, config } = loadClawletsConfig({ repoRoot, runtimeDir: params.runtimeDir });
  return { repoRoot, layout, config };
}

export function loadHostContextOrExit(params: { cwd: string; runtimeDir?: string; hostArg: unknown }): HostContext | null {
  const hostName = resolveHostNameOrExit({ cwd: params.cwd, runtimeDir: params.runtimeDir, hostArg: params.hostArg });
  if (!hostName) return null;
  const { repoRoot, layout, config } = loadRepoContext({ cwd: params.cwd, runtimeDir: params.runtimeDir });
  const hostCfg = config.hosts[hostName];
  if (!hostCfg) throw new Error(`missing host in fleet/clawlets.json: ${hostName}`);
  return { repoRoot, layout, config, hostName, hostCfg };
}
