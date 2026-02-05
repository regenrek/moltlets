import type { OpenclawSchemaArtifact } from "./artifact.js";
import { getPinnedOpenclawSchemaArtifact } from "./artifact.js";
import { fetchNixOpenclawSourceInfo, getNixOpenclawRevFromFlakeLock } from "../../nix-openclaw-source.js";

type FetchSourceInfo = typeof fetchNixOpenclawSourceInfo;
type GetPinnedSchema = typeof getPinnedOpenclawSchemaArtifact;
type GetNixRev = typeof getNixOpenclawRevFromFlakeLock;

export type OpenclawSchemaPinnedComparison =
  | { ok: true; nixOpenclawRev: string; openclawRev: string; matches: boolean }
  | { ok: false; nixOpenclawRev: string; error: string };

export type OpenclawSchemaUpstreamComparison =
  | { ok: true; nixOpenclawRef: string; openclawRev: string; matches: boolean }
  | { ok: false; nixOpenclawRef: string; error: string };

export type OpenclawSchemaComparison = {
  schemaVersion: string;
  schemaRev: string;
  pinned?: OpenclawSchemaPinnedComparison;
  upstream: OpenclawSchemaUpstreamComparison;
  warnings: string[];
};

export type OpenclawSchemaComparisonSummary = {
  schemaVersion: string;
  schemaRev: string;
  warnings: string[];
  pinned?:
    | {
        ok: true;
        status: "ok" | "warn";
        nixOpenclawRev: string;
        openclawRev: string;
        matches: boolean;
      }
    | {
        ok: false;
        status: "warn";
        nixOpenclawRev: string;
        error: string;
      };
  upstream:
    | {
        ok: true;
        status: "ok" | "warn";
        nixOpenclawRef: string;
        openclawRev: string;
        matches: boolean;
      }
    | {
        ok: false;
        status: "warn";
        nixOpenclawRef: string;
        error: string;
      };
};

type CompareDeps = {
  schema?: OpenclawSchemaArtifact;
  getPinnedSchema?: GetPinnedSchema;
  getNixOpenclawRevFromFlakeLock?: GetNixRev;
  fetchNixOpenclawSourceInfo?: FetchSourceInfo;
  requireSchemaRev?: boolean;
};

export async function compareOpenclawSchemaToNixOpenclaw(
  params: { repoRoot: string } & CompareDeps,
): Promise<OpenclawSchemaComparison | null> {
  const getPinnedSchema = params.getPinnedSchema ?? getPinnedOpenclawSchemaArtifact;
  const getNixRev = params.getNixOpenclawRevFromFlakeLock ?? getNixOpenclawRevFromFlakeLock;
  const fetchSourceInfo = params.fetchNixOpenclawSourceInfo ?? fetchNixOpenclawSourceInfo;
  const schema = params.schema ?? getPinnedSchema();
  const schemaRev = schema?.openclawRev?.trim() || "";
  const schemaVersion = schema?.version?.trim() || "";
  const requireSchemaRev = params.requireSchemaRev ?? false;
  if (requireSchemaRev && !schemaRev) return null;

  const warnings: string[] = [];
  const nixOpenclawRev = getNixRev(params.repoRoot);
  let pinned: OpenclawSchemaPinnedComparison | undefined;
  if (nixOpenclawRev) {
    const pinnedResult = await fetchSourceInfo({ ref: nixOpenclawRev });
    if (!pinnedResult.ok) {
      warnings.push(`pinned nix-openclaw fetch failed: ${pinnedResult.error}`);
      pinned = { ok: false, nixOpenclawRev, error: pinnedResult.error };
    } else {
      const matches = schemaRev ? pinnedResult.info.rev === schemaRev : false;
      pinned = { ok: true, nixOpenclawRev, openclawRev: pinnedResult.info.rev, matches };
    }
  }

  const upstreamResult = await fetchSourceInfo({ ref: "main" });
  let upstream: OpenclawSchemaUpstreamComparison;
  if (!upstreamResult.ok) {
    warnings.push(`upstream nix-openclaw fetch failed: ${upstreamResult.error}`);
    upstream = { ok: false, nixOpenclawRef: "main", error: upstreamResult.error };
  } else {
    const matches = schemaRev ? upstreamResult.info.rev === schemaRev : false;
    upstream = { ok: true, nixOpenclawRef: "main", openclawRev: upstreamResult.info.rev, matches };
  }

  return {
    schemaVersion,
    schemaRev,
    pinned,
    upstream,
    warnings,
  };
}

export function summarizeOpenclawSchemaComparison(
  comparison: OpenclawSchemaComparison,
): OpenclawSchemaComparisonSummary {
  const pinned: OpenclawSchemaComparisonSummary["pinned"] = comparison.pinned
    ? comparison.pinned.ok
      ? {
          ok: true,
          status: comparison.pinned.matches ? "ok" : "warn",
          nixOpenclawRev: comparison.pinned.nixOpenclawRev,
          openclawRev: comparison.pinned.openclawRev,
          matches: comparison.pinned.matches,
        }
      : {
          ok: false,
          status: "warn",
          nixOpenclawRev: comparison.pinned.nixOpenclawRev,
          error: comparison.pinned.error,
        }
    : undefined;

  const upstream: OpenclawSchemaComparisonSummary["upstream"] = comparison.upstream.ok
    ? {
        ok: true,
        status: comparison.upstream.matches ? "ok" : "warn",
        nixOpenclawRef: comparison.upstream.nixOpenclawRef,
        openclawRev: comparison.upstream.openclawRev,
        matches: comparison.upstream.matches,
      }
    : {
        ok: false,
        status: "warn",
        nixOpenclawRef: comparison.upstream.nixOpenclawRef,
        error: comparison.upstream.error,
      };

  return {
    schemaVersion: comparison.schemaVersion,
    schemaRev: comparison.schemaRev,
    warnings: comparison.warnings,
    pinned,
    upstream,
  };
}
