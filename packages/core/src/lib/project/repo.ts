import path from "node:path";
import type { ConfigStore, MaybePromise } from "../storage/config-store.js";
import { FileSystemConfigStore } from "../storage/fs-config-store.js";

const defaultStore = new FileSystemConfigStore();

function requireSyncResult<T>(value: MaybePromise<T>, field: string): T {
  if (value && typeof (value as { then?: unknown }).then === "function") {
    throw new Error(`ConfigStore.${field} must be synchronous for findRepoRoot`);
  }
  return value as T;
}

export function findRepoRoot(startDir: string, store: ConfigStore = defaultStore): string {
  let current = path.resolve(startDir);
  for (;;) {
    const flake = path.join(current, "flake.nix");
    const scriptsDir = path.join(current, "scripts");
    const flakeExists = requireSyncResult(store.exists(flake), "exists");
    const scriptsStat = requireSyncResult(store.stat(scriptsDir), "stat");
    if (flakeExists && scriptsStat?.isDirectory) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}
