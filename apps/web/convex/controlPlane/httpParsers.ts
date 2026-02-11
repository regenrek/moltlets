import { HOST_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
import { RUN_STATUSES } from "@clawlets/core/lib/runtime/run-constants";
import { RUN_EVENT_LEVELS } from "@clawlets/core/lib/runtime/run-constants";
import { Base64 } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  ensureOptionalBoundedString,
  sanitizeDesiredGatewaySummary,
  sanitizeDesiredHostSummary,
  CONTROL_PLANE_LIMITS,
} from "../shared/controlPlane";

const HOST_STATUS_SET = new Set<string>(HOST_STATUSES);
const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);
const RUN_EVENT_LEVEL_SET = new Set<string>(RUN_EVENT_LEVELS);

export const METADATA_SYNC_LIMITS = {
  projectConfigs: 500,
  hosts: 200,
  gateways: 500,
  secretWiring: 2000,
  secretWiringPerHost: 500,
} as const;

const RUNNER_EVENT_AUTH_BEARER_RE = /(Authorization:\s*Bearer\s+)([^\s]+)/gi;
const RUNNER_EVENT_AUTH_BASIC_RE = /(Authorization:\s*Basic\s+)([^\s]+)/gi;
const RUNNER_EVENT_URL_CREDENTIALS_RE = /(https?:\/\/)([^/\s@]+@)/g;
const RUNNER_EVENT_QUERY_SECRET_RE = /([?&](?:access_token|token|auth|api_key|apikey|apiKey)=)([^&\s]+)/gi;
const RUNNER_EVENT_ASSIGNMENT_SECRET_RE =
  /\b((?:access|refresh|id)?_?token|token|api_key|apikey|apiKey|secret|password)\s*[:=]\s*([^\s]+)/gi;

function redactRunnerEventCommonSecrets(input: string): { message: string; redacted: boolean } {
  let output = input;
  const before = output;
  output = output.replace(RUNNER_EVENT_AUTH_BEARER_RE, "$1<redacted>");
  output = output.replace(RUNNER_EVENT_AUTH_BASIC_RE, "$1<redacted>");
  output = output.replace(RUNNER_EVENT_URL_CREDENTIALS_RE, "$1<redacted>@");
  output = output.replace(RUNNER_EVENT_QUERY_SECRET_RE, "$1<redacted>");
  output = output.replace(RUNNER_EVENT_ASSIGNMENT_SECRET_RE, "$1=<redacted>");
  return { message: output, redacted: output !== before };
}

export function sanitizeRunnerEventMessageForStorage(raw: unknown): { message: string; redacted: boolean } {
  const message = typeof raw === "string" ? raw.trim() : "";
  if (!message) return { message: "", redacted: false };
  return redactRunnerEventCommonSecrets(message);
}

type RunEventPhaseMeta = { kind: "phase"; phase: "command_start" | "command_end" | "post_run_cleanup" | "truncated" };
type RunEventExitMeta = { kind: "exit"; code: number };

export type RunnerRunEventForStorage = {
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: RunEventPhaseMeta | RunEventExitMeta;
  redacted?: boolean;
};

function sanitizeRunnerEventMeta(value: unknown): RunEventPhaseMeta | RunEventExitMeta | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.kind === "phase") {
    if (
      row.phase === "command_start" ||
      row.phase === "command_end" ||
      row.phase === "post_run_cleanup" ||
      row.phase === "truncated"
    ) {
      return { kind: "phase", phase: row.phase };
    }
    return undefined;
  }
  if (row.kind === "exit") {
    if (typeof row.code !== "number" || !Number.isFinite(row.code) || !Number.isInteger(row.code)) return undefined;
    if (row.code < -1 || row.code > 255) return undefined;
    return { kind: "exit", code: row.code };
  }
  return undefined;
}

export function sanitizeRunnerRunEventsForStorage(events: unknown[], now = Date.now()): RunnerRunEventForStorage[] {
  const safeEvents: RunnerRunEventForStorage[] = [];
  for (const row of events.slice(0, 200)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const eventObj = row as Record<string, unknown>;
    const levelRaw = typeof eventObj.level === "string" ? eventObj.level : "";
    if (!RUN_EVENT_LEVEL_SET.has(levelRaw)) continue;
    const { message, redacted } = sanitizeRunnerEventMessageForStorage(eventObj.message);
    if (!message) continue;
    safeEvents.push({
      ts: typeof eventObj.ts === "number" && Number.isFinite(eventObj.ts) ? Math.trunc(eventObj.ts) : now,
      level: levelRaw as RunnerRunEventForStorage["level"],
      message,
      meta: sanitizeRunnerEventMeta(eventObj.meta),
      redacted: Boolean(eventObj.redacted) || redacted || undefined,
    });
  }
  return safeEvents;
}

function asBoundedOptional(value: unknown, field: string, max = CONTROL_PLANE_LIMITS.hash): string | undefined {
  return ensureOptionalBoundedString(typeof value === "string" ? value : undefined, field, max);
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Base64.toByteArray(padded);
}

function toBase64Url(bytes: Uint8Array): string {
  return Base64.fromByteArray(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function deriveSealedInputKeyId(spkiB64Url: string): Promise<string> {
  const spki = fromBase64Url(spkiB64Url);
  const digestInput = new Uint8Array(spki.byteLength);
  digestInput.set(spki);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  return toBase64Url(new Uint8Array(digest));
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
  if (tokenDoc.expiresAt !== undefined) {
    if (typeof tokenDoc.expiresAt !== "number" || tokenDoc.expiresAt <= params.now) return false;
  }
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
  supportsSealedInput?: boolean;
  sealedInputAlg?: string;
  sealedInputPubSpkiB64?: string;
  sealedInputKeyId?: string;
  supportsInfraApply?: boolean;
};

export async function parseRunnerHeartbeatCapabilities(
  value: unknown,
): Promise<{ ok: true; capabilities: ParsedRunnerCapabilities } | { ok: false; error: string }> {
  const capabilities =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const supportsSealedInput =
    typeof capabilities?.supportsSealedInput === "boolean"
      ? capabilities.supportsSealedInput
      : undefined;
  const supportsInfraApply =
    typeof capabilities?.supportsInfraApply === "boolean" ? capabilities.supportsInfraApply : undefined;

  const sealedInputAlgRaw =
    typeof capabilities?.sealedInputAlg === "string"
      ? capabilities.sealedInputAlg
      : undefined;
  const sealedInputAlg = sealedInputAlgRaw?.trim();
  if (sealedInputAlgRaw !== undefined && sealedInputAlg !== "rsa-oaep-3072/aes-256-gcm") {
    return { ok: false, error: "invalid capabilities.sealedInputAlg" };
  }

  const sealedInputPubSpkiB64Raw =
    typeof capabilities?.sealedInputPubSpkiB64 === "string"
      ? capabilities.sealedInputPubSpkiB64
      : undefined;
  const sealedInputPubSpkiB64 = sealedInputPubSpkiB64Raw?.trim();
  if (
    sealedInputPubSpkiB64Raw !== undefined
    && (!sealedInputPubSpkiB64
      || sealedInputPubSpkiB64.length > 8192
      || !/^[A-Za-z0-9_-]+$/.test(sealedInputPubSpkiB64))
  ) {
    return { ok: false, error: "invalid capabilities.sealedInputPubSpkiB64" };
  }
  let derivedKeyId: string | undefined;
  if (sealedInputPubSpkiB64) {
    try {
      derivedKeyId = await deriveSealedInputKeyId(sealedInputPubSpkiB64);
    } catch {
      return { ok: false, error: "invalid capabilities.sealedInputPubSpkiB64" };
    }
  }

  const sealedInputKeyIdRaw =
    typeof capabilities?.sealedInputKeyId === "string"
      ? capabilities.sealedInputKeyId
      : undefined;
  const sealedInputKeyId = sealedInputKeyIdRaw?.trim();
  if (sealedInputKeyIdRaw !== undefined && !sealedInputKeyId) {
    return { ok: false, error: "invalid capabilities.sealedInputKeyId" };
  }
  if (sealedInputKeyId && sealedInputKeyId.length > CONTROL_PLANE_LIMITS.hash) {
    return { ok: false, error: "invalid capabilities.sealedInputKeyId" };
  }
  if (sealedInputKeyId && derivedKeyId && sealedInputKeyId !== derivedKeyId) {
    return { ok: false, error: "invalid capabilities.sealedInputKeyId" };
  }

  if (
    supportsSealedInput
    && (!sealedInputAlg || !sealedInputPubSpkiB64 || !derivedKeyId)
  ) {
    return { ok: false, error: "invalid capabilities.supportsSealedInput" };
  }
  return {
    ok: true,
    capabilities: {
      supportsSealedInput,
      sealedInputAlg,
      sealedInputPubSpkiB64,
      sealedInputKeyId: derivedKeyId ?? sealedInputKeyId,
      supportsInfraApply,
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
