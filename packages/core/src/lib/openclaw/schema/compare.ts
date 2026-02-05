import type { OpenclawSchemaArtifact } from "./artifact.js";
import { getPinnedOpenclawSchemaArtifact } from "./artifact.js";
import { fetchNixClawdbotSourceInfo, getNixClawdbotRevFromFlakeLock } from "../../nix-clawdbot.js";

type FetchSourceInfo = typeof fetchNixClawdbotSourceInfo;
type GetPinnedSchema = typeof getPinnedOpenclawSchemaArtifact;
type GetNixRev = typeof getNixClawdbotRevFromFlakeLock;

export type OpenclawSchemaPinnedComparison =
  | { ok: true; nixClawdbotRev: string; openclawRev: string; matches: boolean }
  | { ok: false; nixClawdbotRev: string; error: string };

export type OpenclawSchemaUpstreamComparison =
  | { ok: true; nixClawdbotRef: string; openclawRev: string; matches: boolean }
  | { ok: false; nixClawdbotRef: string; error: string };

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
        nixClawdbotRev: string;
        openclawRev: string;
        matches: boolean;
      }
    | {
        ok: false;
        status: "warn";
        nixClawdbotRev: string;
        error: string;
      };
  upstream:
    | {
        ok: true;
        status: "ok" | "warn";
        nixClawdbotRef: string;
        openclawRev: string;
        matches: boolean;
      }
    | {
        ok: false;
        status: "warn";
        nixClawdbotRef: string;
        error: string;
      };
};

type CompareDeps = {
  schema?: OpenclawSchemaArtifact;
  getPinnedSchema?: GetPinnedSchema;
  getNixClawdbotRevFromFlakeLock?: GetNixRev;
  fetchNixClawdbotSourceInfo?: FetchSourceInfo;
  requireSchemaRev?: boolean;
};

export async function compareOpenclawSchemaToNixClawdbot(
  params: { repoRoot: string } & CompareDeps,
): Promise<OpenclawSchemaComparison | null> {
  const getPinnedSchema = params.getPinnedSchema ?? getPinnedOpenclawSchemaArtifact;
  const getNixRev = params.getNixClawdbotRevFromFlakeLock ?? getNixClawdbotRevFromFlakeLock;
  const fetchSourceInfo = params.fetchNixClawdbotSourceInfo ?? fetchNixClawdbotSourceInfo;
  const schema = params.schema ?? getPinnedSchema();
  const schemaRev = schema?.openclawRev?.trim() || "";
  const schemaVersion = schema?.version?.trim() || "";
  const requireSchemaRev = params.requireSchemaRev ?? false;
  if (requireSchemaRev && !schemaRev) return null;

  const warnings: string[] = [];
  const nixClawdbotRev = getNixRev(params.repoRoot);
  let pinned: OpenclawSchemaPinnedComparison | undefined;
  if (nixClawdbotRev) {
    const pinnedResult = await fetchSourceInfo({ ref: nixClawdbotRev });
    if (!pinnedResult.ok) {
      warnings.push(`pinned nix-clawdbot fetch failed: ${pinnedResult.error}`);
      pinned = { ok: false, nixClawdbotRev, error: pinnedResult.error };
    } else {
      const matches = schemaRev ? pinnedResult.info.rev === schemaRev : false;
      pinned = { ok: true, nixClawdbotRev, openclawRev: pinnedResult.info.rev, matches };
    }
  }

  const upstreamResult = await fetchSourceInfo({ ref: "main" });
  let upstream: OpenclawSchemaUpstreamComparison;
  if (!upstreamResult.ok) {
    warnings.push(`upstream nix-clawdbot fetch failed: ${upstreamResult.error}`);
    upstream = { ok: false, nixClawdbotRef: "main", error: upstreamResult.error };
  } else {
    const matches = schemaRev ? upstreamResult.info.rev === schemaRev : false;
    upstream = { ok: true, nixClawdbotRef: "main", openclawRev: upstreamResult.info.rev, matches };
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
          nixClawdbotRev: comparison.pinned.nixClawdbotRev,
          openclawRev: comparison.pinned.openclawRev,
          matches: comparison.pinned.matches,
        }
      : {
          ok: false,
          status: "warn",
          nixClawdbotRev: comparison.pinned.nixClawdbotRev,
          error: comparison.pinned.error,
        }
    : undefined;

  const upstream: OpenclawSchemaComparisonSummary["upstream"] = comparison.upstream.ok
    ? {
        ok: true,
        status: comparison.upstream.matches ? "ok" : "warn",
        nixClawdbotRef: comparison.upstream.nixClawdbotRef,
        openclawRev: comparison.upstream.openclawRev,
        matches: comparison.upstream.matches,
      }
    : {
        ok: false,
        status: "warn",
        nixClawdbotRef: comparison.upstream.nixClawdbotRef,
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
