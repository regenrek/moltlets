import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProvisioningProvider } from "../config/providers/index.js";
import type { ProvisionerRuntime } from "./types.js";

function buildAssetCandidates(params: {
  provider: ProvisioningProvider;
  runtime: ProvisionerRuntime;
  moduleUrl: string;
}): string[] {
  const here = path.dirname(fileURLToPath(params.moduleUrl));
  const segments = ["assets", "opentofu", "providers", params.provider] as const;
  const fromModule = [
    path.resolve(here, ...segments),
    path.resolve(here, "..", ...segments),
    path.resolve(here, "..", "..", ...segments),
    path.resolve(here, "..", "..", "..", ...segments),
    path.resolve(here, "..", "..", "..", "..", ...segments),
  ];
  return Array.from(new Set([
    ...fromModule,
    path.resolve(params.runtime.repoRoot, "packages", "cli", "dist", ...segments),
    path.resolve(params.runtime.repoRoot, "packages", "core", "dist", ...segments),
    path.resolve(params.runtime.repoRoot, "packages", "core", "src", ...segments),
  ]));
}

export function resolveBundledOpenTofuAssetDir(params: {
  provider: ProvisioningProvider;
  runtime: ProvisionerRuntime;
  moduleUrl: string;
}): string {
  const candidates = buildAssetCandidates(params);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`missing bundled ${params.provider} OpenTofu assets: ${candidates.join(", ")}`);
}
