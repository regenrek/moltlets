import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePackageRoot(fromUrl: string = import.meta.url): string {
  const dir = path.dirname(fileURLToPath(fromUrl));
  return path.resolve(dir, "..");
}

export function readCliVersion(rootDir: string = resolvePackageRoot()): string {
  const pkgPath = path.join(rootDir, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("missing version in package.json");
  }
  return parsed.version;
}
