import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { hasAuthEnv } from "./lib/env";
import {
  ensureBoundedString,
  ensureOptionalBoundedString,
  sanitizeDesiredGatewaySummary,
  sanitizeDesiredHostSummary,
  sha256Hex,
  CONTROL_PLANE_LIMITS,
} from "./lib/controlPlane";

const http = httpRouter();
const METADATA_SYNC_LIMITS = {
  projectConfigs: 500,
  hosts: 200,
  gateways: 500,
  secretWiring: 2000,
  secretWiringPerHost: 500,
} as const;
const HOST_STATUSES = new Set(["online", "offline", "degraded", "unknown"]);
const RUN_STATUSES = new Set(["queued", "running", "succeeded", "failed", "canceled"]);

if (!hasAuthEnv()) {
  throw new Error("missing SITE_URL / BETTER_AUTH_SECRET / CONVEX_SITE_URL for Better Auth");
}
authComponent.registerRoutes(http, createAuth);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRunnerTokenUsable(params: {
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

function validateMetadataSyncPayloadSizes(params: {
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

function asBoundedOptional(value: unknown, field: string, max = CONTROL_PLANE_LIMITS.hash): string | undefined {
  return ensureOptionalBoundedString(typeof value === "string" ? value : undefined, field, max);
}

function sanitizeHostPatch(patch: unknown): Record<string, unknown> {
  const row = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const desired = sanitizeDesiredHostSummary(row.desired);
  const status =
    typeof row.lastStatus === "string" && HOST_STATUSES.has(row.lastStatus) ? row.lastStatus : undefined;
  const runStatus =
    typeof row.lastRunStatus === "string" && RUN_STATUSES.has(row.lastRunStatus) ? row.lastRunStatus : undefined;
  return {
    provider: asBoundedOptional(row.provider, "hosts.patch.provider"),
    region: asBoundedOptional(row.region, "hosts.patch.region"),
    lastSeenAt: typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt) ? Math.trunc(row.lastSeenAt) : undefined,
    lastStatus: status,
    lastRunId: asBoundedOptional(row.lastRunId, "hosts.patch.lastRunId"),
    lastRunStatus: runStatus,
    desired,
  };
}

function sanitizeGatewayPatch(patch: unknown): Record<string, unknown> {
  const row = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const desired = sanitizeDesiredGatewaySummary(row.desired);
  const status =
    typeof row.lastStatus === "string" && HOST_STATUSES.has(row.lastStatus) ? row.lastStatus : undefined;
  return {
    lastSeenAt: typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt) ? Math.trunc(row.lastSeenAt) : undefined,
    lastStatus: status,
    desired,
  };
}

async function requireRunnerAuth(
  ctx: Parameters<typeof httpAction>[0] extends never ? never : any,
  request: Request,
  expectedProjectId?: string,
): Promise<
  | {
      tokenId: string;
      projectId: string;
      runnerId: string;
      runnerName: string;
    }
  | null
> {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const tokenDoc = await ctx.runQuery(internal.runnerTokens.getByTokenHashInternal, { tokenHash });
  if (!tokenDoc) return null;
  const now = Date.now();
  const runner = await ctx.runQuery(internal.runners.getByIdInternal, { runnerId: tokenDoc.runnerId });
  if (
    !isRunnerTokenUsable({
      tokenDoc,
      runner,
      expectedProjectId,
      now,
    })
  ) {
    return null;
  }
  void ctx.runMutation(internal.runnerTokens.touchLastUsedInternal, {
    tokenId: tokenDoc.tokenId,
    now: Date.now(),
  }).catch(() => {});
  return {
    tokenId: tokenDoc.tokenId,
    projectId: tokenDoc.projectId,
    runnerId: tokenDoc.runnerId,
    runnerName: runner.runnerName,
  };
}

function parseRunnerHeartbeatCapabilities(
  value: unknown,
): {
  ok: true;
  capabilities: {
    supportsLocalSecretsSubmit?: boolean;
    supportsInteractiveSecrets?: boolean;
    supportsInfraApply?: boolean;
    localSecretsPort?: number;
    localSecretsNonce?: string;
  };
} | { ok: false; error: string } {
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

http.route({
  path: "/runner/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid JSON" });
    }
    const payload = body as Record<string, unknown>;
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    const auth = await requireRunnerAuth(ctx, request, projectId);
    if (!auth) return json(401, { error: "unauthorized" });

    const claimedRunnerName = ensureBoundedString(
      typeof payload.runnerName === "string" ? payload.runnerName : "",
      "runnerName",
      CONTROL_PLANE_LIMITS.runnerName,
    );
    if (claimedRunnerName !== auth.runnerName) return json(401, { error: "runner mismatch" });
    const version = ensureOptionalBoundedString(
      typeof payload.version === "string" ? payload.version : undefined,
      "version",
      CONTROL_PLANE_LIMITS.hash,
    );
    const parsedCapabilities = parseRunnerHeartbeatCapabilities(payload.capabilities);
    if (!parsedCapabilities.ok) return json(400, { error: parsedCapabilities.error });
    const res = await ctx.runMutation(internal.runners.upsertHeartbeatInternal, {
      projectId: auth.projectId as any,
      runnerName: auth.runnerName,
      patch: {
        status: "online",
        version,
        capabilities: parsedCapabilities.capabilities,
      },
    });
    return json(200, { ok: true, runnerId: res.runnerId });
  }),
});

http.route({
  path: "/runner/jobs/lease-next",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid JSON" });
    }
    const payload = body as Record<string, unknown>;
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    const auth = await requireRunnerAuth(ctx, request, projectId);
    if (!auth) return json(401, { error: "unauthorized" });

    const leaseTtlMs =
      typeof payload.leaseTtlMs === "number" && Number.isFinite(payload.leaseTtlMs)
        ? Math.trunc(payload.leaseTtlMs)
        : undefined;
    const job = await ctx.runMutation(internal.jobs.leaseNextInternal, {
      projectId: auth.projectId as any,
      runnerId: auth.runnerId as any,
      leaseTtlMs,
    });
    return json(200, { job });
  }),
});

http.route({
  path: "/runner/jobs/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid JSON" });
    }
    const payload = body as Record<string, unknown>;
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    const auth = await requireRunnerAuth(ctx, request, projectId);
    if (!auth) return json(401, { error: "unauthorized" });
    const jobId = typeof payload.jobId === "string" ? payload.jobId : "";
    const leaseId = typeof payload.leaseId === "string" ? payload.leaseId.trim() : "";
    if (!jobId || !leaseId) return json(400, { error: "jobId and leaseId required" });
    const leaseTtlMs =
      typeof payload.leaseTtlMs === "number" && Number.isFinite(payload.leaseTtlMs)
        ? Math.trunc(payload.leaseTtlMs)
        : undefined;
    const result = await ctx.runMutation(internal.jobs.heartbeatInternal, {
      jobId: jobId as any,
      leaseId,
      leaseTtlMs,
    });
    return json(200, result);
  }),
});

http.route({
  path: "/runner/jobs/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid JSON" });
    }
    const payload = body as Record<string, unknown>;
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    const auth = await requireRunnerAuth(ctx, request, projectId);
    if (!auth) return json(401, { error: "unauthorized" });
    const jobId = typeof payload.jobId === "string" ? payload.jobId : "";
    const leaseId = typeof payload.leaseId === "string" ? payload.leaseId.trim() : "";
    const status = typeof payload.status === "string" ? payload.status : "";
    const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage : undefined;
    if (!jobId || !leaseId) return json(400, { error: "jobId and leaseId required" });
    if (status !== "succeeded" && status !== "failed" && status !== "canceled") {
      return json(400, { error: "invalid status" });
    }

    const result = await ctx.runMutation(internal.jobs.completeInternal, {
      jobId: jobId as any,
      leaseId,
      status,
      errorMessage,
    });
    return json(200, result);
  }),
});

http.route({
  path: "/runner/run-events/append-batch",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid JSON" });
    }
    const payload = body as Record<string, unknown>;
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    const auth = await requireRunnerAuth(ctx, request, projectId);
    if (!auth) return json(401, { error: "unauthorized" });

    const runId = typeof payload.runId === "string" ? payload.runId : "";
    const events = Array.isArray(payload.events) ? payload.events : [];
    if (!runId) return json(400, { error: "runId required" });

    await ctx.runMutation(internal.runEvents.appendBatchInternal, {
      runId: runId as any,
      events: events as any,
    });
    return json(200, { ok: true });
  }),
});

http.route({
  path: "/runner/metadata/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { error: "invalid JSON" });
    }
    const payload = body as Record<string, unknown>;
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "";
    const auth = await requireRunnerAuth(ctx, request, projectId);
    if (!auth) return json(401, { error: "unauthorized" });

    const projectConfigs = Array.isArray(payload.projectConfigs) ? payload.projectConfigs : [];
    const hosts = Array.isArray(payload.hosts) ? payload.hosts : [];
    const gateways = Array.isArray(payload.gateways) ? payload.gateways : [];
    const secretWiring = Array.isArray(payload.secretWiring) ? payload.secretWiring : [];
    const sizeError = validateMetadataSyncPayloadSizes({ projectConfigs, hosts, gateways, secretWiring });
    if (sizeError) return json(400, { error: sizeError });
    const erasure = await ctx.runQuery(internal.projectErasure.isDeletionInProgressInternal, {
      projectId: auth.projectId as any,
    });
    if (erasure.active) {
      return json(409, { error: "project deletion in progress" });
    }

    if (projectConfigs.length > 0) {
      await ctx.runMutation(internal.projectConfigs.upsertManyInternal, {
        projectId: auth.projectId as any,
        entries: projectConfigs as any,
      });
    }
    for (const row of hosts) {
      const hostName = ensureBoundedString(
        typeof (row as any).hostName === "string" ? (row as any).hostName : "",
        "hosts[].hostName",
        CONTROL_PLANE_LIMITS.hostName,
      );
      await ctx.runMutation(internal.hosts.upsertInternal, {
        projectId: auth.projectId as any,
        hostName,
        patch: sanitizeHostPatch((row as any).patch),
      });
    }
    for (const row of gateways) {
      const hostName = ensureBoundedString(
        typeof (row as any).hostName === "string" ? (row as any).hostName : "",
        "gateways[].hostName",
        CONTROL_PLANE_LIMITS.hostName,
      );
      const gatewayId = ensureBoundedString(
        typeof (row as any).gatewayId === "string" ? (row as any).gatewayId : "",
        "gateways[].gatewayId",
        CONTROL_PLANE_LIMITS.gatewayId,
      );
      await ctx.runMutation(internal.gateways.upsertInternal, {
        projectId: auth.projectId as any,
        hostName,
        gatewayId,
        patch: sanitizeGatewayPatch((row as any).patch),
      });
    }
    if (secretWiring.length > 0) {
      const byHost = new Map<string, any[]>();
      for (const row of secretWiring) {
        const hostName = String((row as any).hostName || "").trim();
        if (!hostName) continue;
        const entry = {
          secretName: (row as any).secretName,
          scope: (row as any).scope,
          status: (row as any).status,
          required: Boolean((row as any).required),
          lastVerifiedAt:
            typeof (row as any).lastVerifiedAt === "number" ? Math.trunc((row as any).lastVerifiedAt) : undefined,
        };
        const list = byHost.get(hostName) ?? [];
        if (list.length >= METADATA_SYNC_LIMITS.secretWiringPerHost) continue;
        list.push(entry);
        byHost.set(hostName, list);
      }
      for (const [hostName, entries] of byHost.entries()) {
        await ctx.runMutation(internal.secretWiring.upsertManyInternal, {
          projectId: auth.projectId as any,
          hostName,
          entries: entries as any,
        });
      }
    }

    return json(200, { ok: true, synced: { projectConfigs: projectConfigs.length, hosts: hosts.length, gateways: gateways.length, secretWiring: secretWiring.length } });
  }),
});

export default http;

export function __test_isRunnerTokenUsable(params: {
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
  return isRunnerTokenUsable(params);
}

export function __test_validateMetadataSyncPayloadSizes(params: {
  projectConfigs: unknown[];
  hosts: unknown[];
  gateways: unknown[];
  secretWiring: unknown[];
}): string | null {
  return validateMetadataSyncPayloadSizes(params);
}

export function __test_sanitizeHostPatch(patch: unknown): Record<string, unknown> {
  return sanitizeHostPatch(patch);
}

export function __test_sanitizeGatewayPatch(patch: unknown): Record<string, unknown> {
  return sanitizeGatewayPatch(patch);
}

export function __test_parseRunnerHeartbeatCapabilities(value: unknown):
  | {
      ok: true;
      capabilities: {
        supportsLocalSecretsSubmit?: boolean;
        supportsInteractiveSecrets?: boolean;
        supportsInfraApply?: boolean;
        localSecretsPort?: number;
        localSecretsNonce?: string;
      };
    }
  | { ok: false; error: string } {
  return parseRunnerHeartbeatCapabilities(value);
}
