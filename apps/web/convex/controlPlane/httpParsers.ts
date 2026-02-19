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

function asBoundedOptional(value: unknown, field: string, max: number = CONTROL_PLANE_LIMITS.hash): string | undefined {
  return ensureOptionalBoundedString(typeof value === "string" ? value : undefined, field, max);
}

function asNonNegativeInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(max, Math.trunc(value)));
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

export function sanitizeDeployCredsSummary(value: unknown): {
  updatedAtMs: number;
  envFileOrigin: "default" | "explicit";
  envFileStatus: "ok" | "missing" | "invalid";
  envFileError?: string;
  hasGithubToken: boolean;
  hasGithubTokenAccess: boolean;
  githubTokenAccessMessage?: string;
  hasGitRemoteOrigin: boolean;
  sopsAgeKeyFileSet: boolean;
  gitRemoteOrigin?: string;
  projectTokenKeyrings: {
    hcloud: {
      hasActive: boolean;
      itemCount: number;
      items: Array<{ id: string; label: string; maskedValue: string; isActive: boolean }>;
    };
    tailscale: {
      hasActive: boolean;
      itemCount: number;
      items: Array<{ id: string; label: string; maskedValue: string; isActive: boolean }>;
    };
  };
  fleetSshAuthorizedKeys: { count: number; items: string[] };
  fleetSshKnownHosts: { count: number; items: string[] };
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const updatedAtMs = asNonNegativeInt(row.updatedAtMs, 1_000_000_000_000_000);
  if (updatedAtMs === null) return null;

  const envFileOrigin = row.envFileOrigin === "explicit" ? "explicit" : "default";
  const envFileStatus = row.envFileStatus === "ok" || row.envFileStatus === "invalid" ? row.envFileStatus : "missing";
  const envFileError = asBoundedOptional(row.envFileError, "deployCredsSummary.envFileError", CONTROL_PLANE_LIMITS.projectConfigPath);
  const gitRemoteOrigin = asBoundedOptional(row.gitRemoteOrigin, "deployCredsSummary.gitRemoteOrigin", CONTROL_PLANE_LIMITS.projectConfigPath);
  const hasGitRemoteOrigin = typeof row.hasGitRemoteOrigin === "boolean"
    ? row.hasGitRemoteOrigin
    : Boolean(gitRemoteOrigin);
  const hasGithubTokenAccess = typeof row.hasGithubTokenAccess === "boolean" ? row.hasGithubTokenAccess : true;
  const githubTokenAccessMessage = asBoundedOptional(
    row.githubTokenAccessMessage,
    "deployCredsSummary.githubTokenAccessMessage",
    CONTROL_PLANE_LIMITS.errorMessage,
  );

  const keyrings =
    row.projectTokenKeyrings && typeof row.projectTokenKeyrings === "object" && !Array.isArray(row.projectTokenKeyrings)
      ? row.projectTokenKeyrings as Record<string, unknown>
      : {};
  const hcloud =
    keyrings.hcloud && typeof keyrings.hcloud === "object" && !Array.isArray(keyrings.hcloud)
      ? keyrings.hcloud as Record<string, unknown>
      : {};
  const tailscale =
    keyrings.tailscale && typeof keyrings.tailscale === "object" && !Array.isArray(keyrings.tailscale)
      ? keyrings.tailscale as Record<string, unknown>
      : {};

  const hcloudItemCount = asNonNegativeInt(hcloud.itemCount, 10_000) ?? 0;
  const tailscaleItemCount = asNonNegativeInt(tailscale.itemCount, 10_000) ?? 0;
  const toKeyringItems = (raw: unknown): Array<{ id: string; label: string; maskedValue: string; isActive: boolean }> => {
    if (!Array.isArray(raw)) return [];
    const items: Array<{ id: string; label: string; maskedValue: string; isActive: boolean }> = [];
    const seen = new Set<string>();
    for (const row of raw.slice(0, 128)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const item = row as Record<string, unknown>;
      const id = asBoundedOptional(item.id, "deployCredsSummary.projectTokenKeyrings.items.id", CONTROL_PLANE_LIMITS.hash);
      const label = asBoundedOptional(
        item.label,
        "deployCredsSummary.projectTokenKeyrings.items.label",
        CONTROL_PLANE_LIMITS.hostName,
      );
      const maskedValue = asBoundedOptional(
        item.maskedValue,
        "deployCredsSummary.projectTokenKeyrings.items.maskedValue",
        CONTROL_PLANE_LIMITS.projectConfigPath,
      );
      if (!id || !label || !maskedValue || seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        label,
        maskedValue,
        isActive: item.isActive === true,
      });
    }
    return items;
  };
  const toSshListSummary = (raw: unknown, fieldPrefix: string): { count: number; items: string[] } => {
    const row = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const count = asNonNegativeInt(row.count, 10_000) ?? 0;
    const itemsRaw = Array.isArray(row.items) ? row.items : [];
    const items: string[] = [];
    for (const entry of itemsRaw.slice(0, 500)) {
      const value = asBoundedOptional(entry, `${fieldPrefix}.items`, CONTROL_PLANE_LIMITS.projectConfigPath);
      if (!value) continue;
      items.push(value);
    }
    return {
      count: Math.max(count, items.length),
      items,
    };
  };
  const hcloudItems = toKeyringItems(hcloud.items);
  const tailscaleItems = toKeyringItems(tailscale.items);
  const fleetSshAuthorizedKeys = toSshListSummary(
    row.fleetSshAuthorizedKeys,
    "deployCredsSummary.fleetSshAuthorizedKeys",
  );
  const fleetSshKnownHosts = toSshListSummary(
    row.fleetSshKnownHosts,
    "deployCredsSummary.fleetSshKnownHosts",
  );

  return {
    updatedAtMs,
      envFileOrigin,
      envFileStatus,
      ...(envFileError ? { envFileError } : {}),
      hasGithubToken: Boolean(row.hasGithubToken),
      hasGitRemoteOrigin,
      hasGithubTokenAccess,
      ...(githubTokenAccessMessage ? { githubTokenAccessMessage } : {}),
      ...(gitRemoteOrigin ? { gitRemoteOrigin } : {}),
      sopsAgeKeyFileSet: Boolean(row.sopsAgeKeyFileSet),
      projectTokenKeyrings: {
      hcloud: { hasActive: Boolean(hcloud.hasActive), itemCount: hcloudItemCount, items: hcloudItems },
      tailscale: { hasActive: Boolean(tailscale.hasActive), itemCount: tailscaleItemCount, items: tailscaleItems },
    },
    fleetSshAuthorizedKeys,
    fleetSshKnownHosts,
  };
}

export type ParsedRunnerCapabilities = {
  supportsSealedInput?: boolean;
  sealedInputAlg?: string;
  sealedInputPubSpkiB64?: string;
  sealedInputKeyId?: string;
  supportsInfraApply?: boolean;
  hasNix?: boolean;
  nixBin?: string;
  nixVersion?: string;
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
  const hasNixRaw = capabilities?.hasNix;
  const hasNix = typeof hasNixRaw === "boolean" ? hasNixRaw : undefined;

  const nixBinRaw =
    typeof capabilities?.nixBin === "string"
      ? capabilities.nixBin
      : undefined;
  const nixBin = nixBinRaw?.trim();
  if (nixBinRaw !== undefined && (!nixBin || nixBin.length > CONTROL_PLANE_LIMITS.projectConfigPath)) {
    return { ok: false, error: "invalid capabilities.nixBin" };
  }

  const nixVersionRaw =
    typeof capabilities?.nixVersion === "string"
      ? capabilities.nixVersion
      : undefined;
  const nixVersion = nixVersionRaw?.trim();
  if (nixVersionRaw !== undefined && (!nixVersion || nixVersion.length > CONTROL_PLANE_LIMITS.projectConfigPath)) {
    return { ok: false, error: "invalid capabilities.nixVersion" };
  }

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

  const hasNixNormalized = hasNix ?? (nixVersion ? true : undefined);
  if (hasNixNormalized === false && (nixBin || nixVersion)) {
    return { ok: false, error: "invalid capabilities.hasNix" };
  }
  if (hasNixNormalized === true && !nixVersion) {
    return { ok: false, error: "invalid capabilities.hasNix" };
  }

  return {
    ok: true,
    capabilities: {
      supportsSealedInput,
      sealedInputAlg,
      sealedInputPubSpkiB64,
      sealedInputKeyId: derivedKeyId ?? sealedInputKeyId,
      supportsInfraApply,
      hasNix: hasNixNormalized,
      nixBin,
      nixVersion,
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
