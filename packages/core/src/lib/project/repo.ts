import path from "node:path";
import type { ConfigStore } from "../storage/config-store.js";
import { FileSystemConfigStore } from "../storage/fs-config-store.js";
import { requireSyncResult } from "../storage/require-sync-result.js";

const defaultStore = new FileSystemConfigStore();

export function findRepoRoot(startDir: string, store: ConfigStore = defaultStore): string {
  let current = path.resolve(startDir);
  for (;;) {
    const flake = path.join(current, "flake.nix");
    const scriptsDir = path.join(current, "scripts");
    const flakeExists = requireSyncResult(store.exists(flake), "exists", "findRepoRoot");
    const scriptsStat = requireSyncResult(store.stat(scriptsDir), "stat", "findRepoRoot");
    if (flakeExists && scriptsStat?.isDirectory) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}
