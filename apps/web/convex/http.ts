import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authComponent, createAuth } from "./auth";
import {
  ensureBoundedString,
  ensureOptionalBoundedString,
  sha256Hex,
  CONTROL_PLANE_LIMITS,
} from "./shared/controlPlane";
import {
  isRunnerTokenUsable,
  METADATA_SYNC_LIMITS,
  parseRunnerHeartbeatCapabilities,
  sanitizeGatewayPatch,
  sanitizeHostPatch,
  validateMetadataSyncPayloadSizes,
} from "./controlPlane/httpParsers";
import { touchRunnerTokenLastUsed } from "./controlPlane/runnerAuth";

const http = httpRouter();
type HttpActionCtx = Parameters<Parameters<typeof httpAction>[0]>[0];

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

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function requireRunnerAuth(
  ctx: HttpActionCtx,
  request: Request,
  expectedProjectId?: string,
): Promise<
  | {
      tokenId: Id<"runnerTokens">;
      projectId: Id<"projects">;
      runnerId: Id<"runners">;
      runnerName: string;
    }
  | null
> {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const tokenDoc = await ctx.runQuery(internal.controlPlane.runnerTokens.getByTokenHashInternal, { tokenHash });
  if (!tokenDoc) return null;
  const now = Date.now();
  const runner = await ctx.runQuery(internal.controlPlane.runners.getByIdInternal, { runnerId: tokenDoc.runnerId });
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
  await touchRunnerTokenLastUsed(ctx, {
    tokenId: tokenDoc.tokenId,
    now: Date.now(),
  });
  if (!runner) return null;
  return {
    tokenId: tokenDoc.tokenId,
    projectId: tokenDoc.projectId,
    runnerId: tokenDoc.runnerId,
    runnerName: runner.runnerName,
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
    const res = await ctx.runMutation(internal.controlPlane.runners.upsertHeartbeatInternal, {
      projectId: auth.projectId,
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
    const job = await ctx.runMutation(internal.controlPlane.jobs.leaseNextInternal, {
      projectId: auth.projectId,
      runnerId: auth.runnerId,
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
    const result = await ctx.runMutation(internal.controlPlane.jobs.heartbeatInternal, {
      jobId: jobId as Id<"jobs">,
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

    const result = await ctx.runMutation(internal.controlPlane.jobs.completeInternal, {
      jobId: jobId as Id<"jobs">,
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

    await ctx.runMutation(internal.controlPlane.runEvents.appendBatchInternal, {
      runId: runId as Id<"runs">,
      events: events as Array<{
        ts: number;
        level: string;
        message: string;
        meta?:
          | { kind: "phase"; phase: "command_start" | "command_end" | "post_run_cleanup" | "truncated" }
          | { kind: "exit"; code: number };
        redacted?: boolean;
      }>,
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
    const erasure = await ctx.runQuery(internal.controlPlane.projectErasure.isDeletionInProgressInternal, {
      projectId: auth.projectId,
    });
    if (erasure.active) {
      return json(409, { error: "project deletion in progress" });
    }

    if (projectConfigs.length > 0) {
      await ctx.runMutation(internal.controlPlane.projectConfigs.upsertManyInternal, {
        projectId: auth.projectId,
        entries: projectConfigs as Array<{
          path: string;
          type: "fleet" | "host" | "gateway" | "provider" | "raw";
          sha256?: string;
          error?: string;
        }>,
      });
    }
    for (const row of hosts) {
      const rowObj = asObject(row) ?? {};
      const hostName = ensureBoundedString(
        typeof rowObj.hostName === "string" ? rowObj.hostName : "",
        "hosts[].hostName",
        CONTROL_PLANE_LIMITS.hostName,
      );
      await ctx.runMutation(internal.controlPlane.hosts.upsertInternal, {
        projectId: auth.projectId,
        hostName,
        patch: sanitizeHostPatch(rowObj.patch),
      });
    }
    for (const row of gateways) {
      const rowObj = asObject(row) ?? {};
      const hostName = ensureBoundedString(
        typeof rowObj.hostName === "string" ? rowObj.hostName : "",
        "gateways[].hostName",
        CONTROL_PLANE_LIMITS.hostName,
      );
      const gatewayId = ensureBoundedString(
        typeof rowObj.gatewayId === "string" ? rowObj.gatewayId : "",
        "gateways[].gatewayId",
        CONTROL_PLANE_LIMITS.gatewayId,
      );
      await ctx.runMutation(internal.controlPlane.gateways.upsertInternal, {
        projectId: auth.projectId,
        hostName,
        gatewayId,
        patch: sanitizeGatewayPatch(rowObj.patch),
      });
    }
    if (secretWiring.length > 0) {
      const byHost = new Map<
        string,
        Array<{
          secretName: string;
          scope: "bootstrap" | "updates" | "openclaw";
          status: "configured" | "missing" | "placeholder" | "warn";
          required: boolean;
          lastVerifiedAt?: number;
        }>
      >();
      for (const row of secretWiring) {
        const rowObj = asObject(row) ?? {};
        const hostName = typeof rowObj.hostName === "string" ? rowObj.hostName.trim() : "";
        if (!hostName) continue;
        const secretName = typeof rowObj.secretName === "string" ? rowObj.secretName : "";
        const scope = typeof rowObj.scope === "string" ? rowObj.scope : "";
        const status = typeof rowObj.status === "string" ? rowObj.status : "";
        if (!secretName || !scope || !status) continue;
        const entry = {
          secretName,
          scope: scope as "bootstrap" | "updates" | "openclaw",
          status: status as "configured" | "missing" | "placeholder" | "warn",
          required: Boolean(rowObj.required),
          lastVerifiedAt:
            typeof rowObj.lastVerifiedAt === "number" ? Math.trunc(rowObj.lastVerifiedAt) : undefined,
        };
        const list = byHost.get(hostName) ?? [];
        if (list.length >= METADATA_SYNC_LIMITS.secretWiringPerHost) continue;
        list.push(entry);
        byHost.set(hostName, list);
      }
      for (const [hostName, entries] of byHost.entries()) {
        await ctx.runMutation(internal.controlPlane.secretWiring.upsertManyInternal, {
          projectId: auth.projectId,
          hostName,
          entries,
        });
      }
    }

    return json(200, { ok: true, synced: { projectConfigs: projectConfigs.length, hosts: hosts.length, gateways: gateways.length, secretWiring: secretWiring.length } });
  }),
});

export default http;
