import process from "node:process";
import { findRepoRoot } from "./repo.js";
import { loadClawletsConfig, resolveHostName } from "./clawlets-config.js";

function printHostTips(lines: string[]): void {
  for (const l of lines) console.error(`tip: ${l}`);
}

export function resolveHostNameOrExit(params: {
  cwd: string;
  runtimeDir?: string;
  hostArg: unknown;
}): string | null {
  const repoRoot = findRepoRoot(params.cwd);
  const { config } = loadClawletsConfig({ repoRoot, runtimeDir: params.runtimeDir });
  const resolved = resolveHostName({ config, host: params.hostArg });
  if (!resolved.ok) {
    console.error(`warn: ${resolved.message}`);
    printHostTips(resolved.tips);
    process.exitCode = 1;
    return null;
  }
  return resolved.host;
}
