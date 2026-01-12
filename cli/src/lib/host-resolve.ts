import process from "node:process";
import { findRepoRoot } from "@clawdbot/clawdlets-core/lib/repo";
import { loadClawdletsConfig, resolveHostName } from "@clawdbot/clawdlets-core/lib/clawdlets-config";
import type { Stack, StackHost } from "@clawdbot/clawdlets-core/stack";

function printHostTips(lines: string[]): void {
  for (const l of lines) console.error(`tip: ${l}`);
}

export function resolveHostNameOrExit(params: {
  cwd: string;
  stackDir?: string;
  hostArg: unknown;
}): string | null {
  const repoRoot = findRepoRoot(params.cwd);
  const { config } = loadClawdletsConfig({ repoRoot, stackDir: params.stackDir });
  const resolved = resolveHostName({ config, host: params.hostArg });
  if (!resolved.ok) {
    console.error(`warn: ${resolved.message}`);
    printHostTips(resolved.tips);
    process.exitCode = 1;
    return null;
  }
  return resolved.host;
}

export function requireStackHostOrExit(stack: Stack, host: string): StackHost | null {
  const h = stack.hosts[host];
  if (h) return h;
  const available = Object.keys(stack.hosts || {});
  console.error(`warn: unknown stack host: ${host}`);
  printHostTips([
    available.length > 0 ? `stack hosts: ${available.join(", ")}` : "stack hosts: (none)",
    "pass --host <name> to select a host",
    "if you renamed your host, update .clawdlets/stack.json to match infra/configs/clawdlets.json",
  ]);
  process.exitCode = 1;
  return null;
}
