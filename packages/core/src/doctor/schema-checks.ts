import {
  compareOpenclawSchemaToNixOpenclaw,
  summarizeOpenclawSchemaComparison,
} from "../lib/openclaw/schema/compare.js";
import { getPinnedOpenclawSchemaArtifact } from "../lib/openclaw/schema/artifact.js";
import { fetchNixOpenclawSourceInfo, getNixOpenclawRevFromFlakeLock } from "../lib/nix-openclaw-source.js";
import type { DoctorCheck } from "./types.js";

type SchemaCheckDeps = {
  getPinnedSchema?: typeof getPinnedOpenclawSchemaArtifact;
  getNixOpenclawRevFromFlakeLock?: typeof getNixOpenclawRevFromFlakeLock;
  fetchNixOpenclawSourceInfo?: typeof fetchNixOpenclawSourceInfo;
};

export async function checkSchemaVsNixOpenclaw(
  params: { repoRoot: string } & SchemaCheckDeps,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const comparison = await compareOpenclawSchemaToNixOpenclaw({
    repoRoot: params.repoRoot,
    getPinnedSchema: params.getPinnedSchema ?? getPinnedOpenclawSchemaArtifact,
    getNixOpenclawRevFromFlakeLock: params.getNixOpenclawRevFromFlakeLock ?? getNixOpenclawRevFromFlakeLock,
    fetchNixOpenclawSourceInfo: params.fetchNixOpenclawSourceInfo ?? fetchNixOpenclawSourceInfo,
    requireSchemaRev: true,
  });
  if (!comparison) return checks;

  const summary = summarizeOpenclawSchemaComparison(comparison);
  const schemaRev = summary.schemaRev;
  const schemaVersion = summary.schemaVersion;
  const pinned = summary.pinned;
  if (pinned) {
    if (!pinned.ok) {
      checks.push({
        scope: "repo",
        status: "warn",
        label: "openclaw schema vs nix-openclaw",
        detail: `pinned nix-openclaw rev=${pinned.nixOpenclawRev.slice(0, 12)}... (${pinned.error})`,
      });
    } else {
      checks.push({
        scope: "repo",
        status: pinned.status,
        label: "openclaw schema vs nix-openclaw",
        detail: pinned.matches
          ? `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}...`
          : `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}... nix=${pinned.openclawRev.slice(0, 12)}...`,
      });
    }
  }

  const upstream = summary.upstream;
  if (!upstream.ok) {
    checks.push({
      scope: "repo",
      status: "warn",
      label: "openclaw schema vs upstream",
      detail: `unable to fetch (main): ${upstream.error}`,
    });
  } else {
    checks.push({
      scope: "repo",
      status: upstream.status,
      label: "openclaw schema vs upstream",
      detail: upstream.matches
        ? `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}...`
        : `schema=v${schemaVersion} rev=${schemaRev.slice(0, 12)}... upstream=${upstream.openclawRev.slice(0, 12)}...`,
    });
  }

  return checks;
}
