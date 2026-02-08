import fs from "node:fs";
import { writeFileAtomic } from "./fs-safe.js";
import type { ConfigStore, ConfigStoreDirEntry, ConfigStoreStat } from "./config-store.js";

function isMissingError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : "";
  return code === "ENOENT" || code === "ENOTDIR";
}

function statSafe(path: string): ConfigStoreStat | null {
  try {
    const info = fs.statSync(path);
    return { isDirectory: info.isDirectory() };
  } catch (err) {
    if (!isMissingError(err)) throw err;
    return null;
  }
}

export class FileSystemConfigStore implements ConfigStore {
  readText(path: string): string {
    return fs.readFileSync(path, "utf8");
  }

  exists(path: string): boolean {
    return statSafe(path) !== null;
  }

  async writeTextAtomic(path: string, text: string): Promise<void> {
    await writeFileAtomic(path, text);
  }

  stat(path: string): ConfigStoreStat | null {
    return statSafe(path);
  }

  readDir(path: string): ConfigStoreDirEntry[] {
    return fs.readdirSync(path, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  }
}
