import { HOST_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
import { RUN_STATUSES } from "@clawlets/core/lib/runtime/run-constants";
import type { Id } from "../_generated/dataModel";
import {
  ensureOptionalBoundedString,
  sanitizeDesiredGatewaySummary,
  sanitizeDesiredHostSummary,
  CONTROL_PLANE_LIMITS,
} from "../shared/controlPlane";

const HOST_STATUS_SET = new Set<string>(HOST_STATUSES);
const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);

export const METADATA_SYNC_LIMITS = {
  projectConfigs: 500,
  hosts: 200,
  gateways: 500,
  secretWiring: 2000,
  secretWiringPerHost: 500,
} as const;

function asBoundedOptional(value: unknown, field: string, max = CONTROL_PLANE_LIMITS.hash): string | undefined {
  return ensureOptionalBoundedString(typeof value === "string" ? value : undefined, field, max);
}

export function isRunnerTokenUsable(params: {
  tokenDoc:
    | {
        projectId: string;
        runnerId: string;
        revokedAt?: number;
        expiresAt?: number;
      }
    | null
    | undefined;
  runner:
    | {
        projectId: string;
        runnerName: string;
      }
    | null
    | undefined;
  expectedProjectId?: string;
  now: number;
}): boolean {
  const tokenDoc = params.tokenDoc;
  const runner = params.runner;
  if (!tokenDoc || tokenDoc.revokedAt) return false;
  if (typeof tokenDoc.expiresAt !== "number" || tokenDoc.expiresAt <= params.now) return false;
  if (params.expectedProjectId && tokenDoc.projectId !== params.expectedProjectId) return false;
  if (!runner) return false;
  if (runner.projectId !== tokenDoc.projectId) return false;
  return true;
}

export function validateMetadataSyncPayloadSizes(params: {
  projectConfigs: unknown[];
  hosts: unknown[];
  gateways: unknown[];
  secretWiring: unknown[];
}): string | null {
  if (params.projectConfigs.length > METADATA_SYNC_LIMITS.projectConfigs) return "projectConfigs too large";
  if (params.hosts.length > METADATA_SYNC_LIMITS.hosts) return "hosts too large";
  if (params.gateways.length > METADATA_SYNC_LIMITS.gateways) return "gateways too large";
  if (params.secretWiring.length > METADATA_SYNC_LIMITS.secretWiring) return "secretWiring too large";
  return null;
}

export type ParsedRunnerCapabilities = {
  supportsLocalSecretsSubmit?: boolean;
  supportsInteractiveSecrets?: boolean;
  supportsInfraApply?: boolean;
  localSecretsPort?: number;
  localSecretsNonce?: string;
};

export function parseRunnerHeartbeatCapabilities(
  value: unknown,
): { ok: true; capabilities: ParsedRunnerCapabilities } | { ok: false; error: string } {
  const capabilities =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const supportsLocalSecretsSubmit =
    typeof capabilities?.supportsLocalSecretsSubmit === "boolean"
      ? capabilities.supportsLocalSecretsSubmit
      : undefined;
  const supportsInteractiveSecrets =
    typeof capabilities?.supportsInteractiveSecrets === "boolean"
      ? capabilities.supportsInteractiveSecrets
      : undefined;
  const supportsInfraApply =
    typeof capabilities?.supportsInfraApply === "boolean" ? capabilities.supportsInfraApply : undefined;
  const localSecretsPort =
    typeof capabilities?.localSecretsPort === "number" && Number.isFinite(capabilities.localSecretsPort)
      ? Math.trunc(capabilities.localSecretsPort)
      : undefined;
  if (localSecretsPort !== undefined && (localSecretsPort < 1024 || localSecretsPort > 65535)) {
    return { ok: false, error: "invalid capabilities.localSecretsPort" };
  }
  const localSecretsNonceRaw =
    typeof capabilities?.localSecretsNonce === "string"
      ? capabilities.localSecretsNonce
      : undefined;
  const localSecretsNonceTrimmed = localSecretsNonceRaw?.trim();
  if (localSecretsNonceRaw !== undefined && !localSecretsNonceTrimmed) {
    return { ok: false, error: "invalid capabilities.localSecretsNonce" };
  }
  if (localSecretsNonceTrimmed && localSecretsNonceTrimmed.length > CONTROL_PLANE_LIMITS.hash) {
    return { ok: false, error: "invalid capabilities.localSecretsNonce" };
  }
  return {
    ok: true,
    capabilities: {
      supportsLocalSecretsSubmit,
      supportsInteractiveSecrets,
      supportsInfraApply,
      localSecretsPort,
      localSecretsNonce: localSecretsNonceTrimmed,
    },
  };
}

export function sanitizeHostPatch(patch: unknown): {
  provider?: string;
  region?: string;
  lastSeenAt?: number;
  lastStatus?: (typeof HOST_STATUSES)[number];
  lastRunId?: Id<"runs">;
  lastRunStatus?: (typeof RUN_STATUSES)[number];
  desired?: ReturnType<typeof sanitizeDesiredHostSummary>;
} {
  const row = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const desired = sanitizeDesiredHostSummary(row.desired);
  const status =
    typeof row.lastStatus === "string" && HOST_STATUS_SET.has(row.lastStatus)
      ? (row.lastStatus as (typeof HOST_STATUSES)[number])
      : undefined;
  const runStatus =
    typeof row.lastRunStatus === "string" && RUN_STATUS_SET.has(row.lastRunStatus)
      ? (row.lastRunStatus as (typeof RUN_STATUSES)[number])
      : undefined;
  const lastRunId = asBoundedOptional(row.lastRunId, "hosts.patch.lastRunId") as Id<"runs"> | undefined;
  return {
    provider: asBoundedOptional(row.provider, "hosts.patch.provider"),
    region: asBoundedOptional(row.region, "hosts.patch.region"),
    lastSeenAt:
      typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt) ? Math.trunc(row.lastSeenAt) : undefined,
    lastStatus: status,
    lastRunId,
    lastRunStatus: runStatus,
    desired,
  };
}

export function sanitizeGatewayPatch(patch: unknown): {
  lastSeenAt?: number;
  lastStatus?: (typeof HOST_STATUSES)[number];
  desired?: ReturnType<typeof sanitizeDesiredGatewaySummary>;
} {
  const row = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const desired = sanitizeDesiredGatewaySummary(row.desired);
  const status =
    typeof row.lastStatus === "string" && HOST_STATUS_SET.has(row.lastStatus)
      ? (row.lastStatus as (typeof HOST_STATUSES)[number])
      : undefined;
  return {
    lastSeenAt:
      typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt) ? Math.trunc(row.lastSeenAt) : undefined,
    lastStatus: status,
    desired,
  };
}
