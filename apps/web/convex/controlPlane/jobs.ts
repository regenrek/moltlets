import { JOB_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
import { validateRunnerJobPayload } from "@clawlets/core/lib/runtime/runner-command-policy";
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import {
  assertNoSecretLikeKeys,
  ensureBoundedString,
  ensureOptionalBoundedString,
  sha256Hex,
  CONTROL_PLANE_LIMITS,
} from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import { JobDoc } from "../shared/validators";
import { JobPayloadMeta } from "../schema";
import {
  canCompleteJob,
  cancelJobPatch,
  cancelRunPatch,
  isTerminalJobStatus,
  resolveRunKind,
} from "./jobState";
import { putRunnerCommandResult, purgeExpiredRunnerCommandResults } from "./jobCommandResults";
import {
  RUNNER_COMMAND_RESULT_BLOB_MAX_BYTES,
  putRunnerCommandResultBlob,
  purgeExpiredRunnerCommandResultBlobs,
} from "./jobCommandResultBlobs";
import { orderLeaseCandidateIds, sortByCreatedAtAsc } from "./jobLeaseOrder";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const ListLimit = 200;
const MAX_JOB_ATTEMPTS = 25;
const SEALED_PENDING_TTL_MS = 5 * 60_000;
const SEALED_INPUT_ALG = "rsa-oaep-3072/aes-256-gcm";
const SEALED_INPUT_MAX_CHARS = 2 * 1024 * 1024;
const LEASE_WINDOW_SIZE = 100;
const JOB_KIND_RE = /^[A-Za-z0-9._-]+$/;

const JobStatusArg = v.union(...literals(JOB_STATUSES));

function validateSealedInputB64(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) fail("conflict", "sealedInputB64 required");
  if (value.length > SEALED_INPUT_MAX_CHARS) fail("conflict", "sealedInputB64 too large");
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    fail("conflict", "sealedInputB64 contains forbidden characters");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail("conflict", "sealedInputB64 invalid");
  return value;
}

function ensureSafeJobKind(raw: string): string {
  const value = ensureBoundedString(raw, "kind", CONTROL_PLANE_LIMITS.jobKind);
  if (!JOB_KIND_RE.test(value)) fail("conflict", "kind invalid");
  return value;
}

async function resolveExistingRun(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runId?: Id<"runs">;
  kind: string;
  title?: string;
  host?: string;
  initiatedByUserId: Id<"users">;
}): Promise<Id<"runs">> {
  const now = Date.now();
  let nextRunId = params.runId;
  if (nextRunId) {
    const existingRun = await params.ctx.db.get(nextRunId);
    if (!existingRun) fail("not_found", "run not found");
    if (existingRun.projectId !== params.projectId) fail("conflict", "run does not belong to project");
    await params.ctx.db.patch(nextRunId, {
      status: "queued",
      errorMessage: undefined,
      finishedAt: undefined,
    });
    return nextRunId;
  }

  nextRunId = await params.ctx.db.insert("runs", {
    projectId: params.projectId,
    kind: resolveRunKind(params.kind),
    status: "queued",
    title: ensureOptionalBoundedString(params.title, "title", CONTROL_PLANE_LIMITS.jobKind),
    host: ensureOptionalBoundedString(params.host, "host", CONTROL_PLANE_LIMITS.hostName),
    initiatedByUserId: params.initiatedByUserId,
    createdAt: now,
    startedAt: now,
  });
  return nextRunId;
}

async function requireTargetRunner(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  targetRunnerId: Id<"runners">;
  sealedRequired: boolean;
}): Promise<{
  sealedInputAlg?: string;
  sealedInputKeyId?: string;
  sealedInputPubSpkiB64?: string;
}> {
  const runner = await params.ctx.db.get(params.targetRunnerId);
  if (!runner || runner.projectId !== params.projectId) fail("not_found", "target runner not found");
  if (runner.lastStatus !== "online") fail("conflict", "target runner offline");
  if (!params.sealedRequired) return {};

  const caps = runner.capabilities;
  if (!caps?.supportsSealedInput) fail("conflict", "target runner does not support sealed input");
  const alg = String(caps.sealedInputAlg || "").trim();
  const keyId = String(caps.sealedInputKeyId || "").trim();
  const pub = String(caps.sealedInputPubSpkiB64 || "").trim();
  if (alg !== SEALED_INPUT_ALG || !keyId || !pub) {
    fail("conflict", "target runner sealed-input capabilities incomplete");
  }
  return { sealedInputAlg: alg, sealedInputKeyId: keyId, sealedInputPubSpkiB64: pub };
}

export const enqueue = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.optional(v.id("runs")),
    kind: v.string(),
    payloadMeta: v.optional(JobPayloadMeta),
    title: v.optional(v.string()),
    host: v.optional(v.string()),
    targetRunnerId: v.optional(v.id("runners")),
  },
  returns: v.object({ jobId: v.id("jobs"), runId: v.id("runs") }),
  handler: async (ctx, { projectId, runId, kind, payloadMeta, title, host, targetRunnerId }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `jobs.enqueue:${access.authed.user._id}`, limit: 60, windowMs: 60_000 });

    const normalizedKind = ensureSafeJobKind(kind);
    if (payloadMeta) assertNoSecretLikeKeys(payloadMeta, "payloadMeta");
    const validatedPayload = validateRunnerJobPayload({
      kind: normalizedKind,
      payloadMeta,
    });
    if (!validatedPayload.ok) fail("conflict", validatedPayload.error);
    const payload =
      Object.keys(validatedPayload.payloadMeta).length > 0
        ? validatedPayload.payloadMeta
        : undefined;
    const nextRunId = await resolveExistingRun({
      ctx,
      projectId,
      runId,
      kind: normalizedKind,
      title,
      host,
      initiatedByUserId: access.authed.user._id,
    });
    const now = Date.now();
    const normalizedTargetRunnerId = targetRunnerId ?? undefined;
    if (normalizedTargetRunnerId) {
      await requireTargetRunner({
        ctx,
        projectId,
        targetRunnerId: normalizedTargetRunnerId,
        sealedRequired: false,
      });
    }

    const payloadHash = payload ? await sha256Hex(JSON.stringify(payload)) : undefined;
    const jobId = await ctx.db.insert("jobs", {
      projectId,
      runId: nextRunId,
      kind: normalizedKind,
      status: "queued",
      payload,
      payloadHash,
      targetRunnerId: normalizedTargetRunnerId,
      attempt: 0,
      createdAt: now,
    });

    return { jobId, runId: nextRunId };
  },
});

export const reserveSealedInput = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.optional(v.id("runs")),
    kind: v.string(),
    payloadMeta: v.optional(JobPayloadMeta),
    title: v.optional(v.string()),
    host: v.optional(v.string()),
    targetRunnerId: v.id("runners"),
  },
  returns: v.object({
    jobId: v.id("jobs"),
    runId: v.id("runs"),
    kind: v.string(),
    targetRunnerId: v.id("runners"),
    sealedInputAlg: v.string(),
    sealedInputKeyId: v.string(),
    sealedInputPubSpkiB64: v.string(),
  }),
  handler: async (
    ctx,
    { projectId, runId, kind, payloadMeta, title, host, targetRunnerId },
  ) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `jobs.reserveSealedInput:${access.authed.user._id}`, limit: 60, windowMs: 60_000 });

    const normalizedKind = ensureSafeJobKind(kind);
    if (payloadMeta) assertNoSecretLikeKeys(payloadMeta, "payloadMeta");
    const validatedPayload = validateRunnerJobPayload({
      kind: normalizedKind,
      payloadMeta,
    });
    if (!validatedPayload.ok) fail("conflict", validatedPayload.error);
    const payload =
      Object.keys(validatedPayload.payloadMeta).length > 0
        ? validatedPayload.payloadMeta
        : undefined;

    const target = await requireTargetRunner({
      ctx,
      projectId,
      targetRunnerId,
      sealedRequired: true,
    });

    const nextRunId = await resolveExistingRun({
      ctx,
      projectId,
      runId,
      kind: normalizedKind,
      title,
      host,
      initiatedByUserId: access.authed.user._id,
    });
    const now = Date.now();
    const payloadHash = payload ? await sha256Hex(JSON.stringify(payload)) : undefined;
    const jobId = await ctx.db.insert("jobs", {
      projectId,
      runId: nextRunId,
      kind: normalizedKind,
      status: "sealed_pending",
      payload,
      payloadHash,
      targetRunnerId,
      sealedInputRequired: true,
      sealedInputAlg: target.sealedInputAlg,
      sealedInputKeyId: target.sealedInputKeyId,
      sealedPendingExpiresAt: now + SEALED_PENDING_TTL_MS,
      attempt: 0,
      createdAt: now,
    });
    return {
      jobId,
      runId: nextRunId,
      kind: normalizedKind,
      targetRunnerId,
      sealedInputAlg: target.sealedInputAlg || SEALED_INPUT_ALG,
      sealedInputKeyId: target.sealedInputKeyId || "",
      sealedInputPubSpkiB64: target.sealedInputPubSpkiB64 || "",
    };
  },
});

export const finalizeSealedEnqueue = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.id("jobs"),
    kind: v.string(),
    sealedInputB64: v.string(),
    sealedInputAlg: v.string(),
    sealedInputKeyId: v.string(),
  },
  returns: v.object({ jobId: v.id("jobs"), runId: v.id("runs") }),
  handler: async (ctx, params) => {
    const { projectId } = params;
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `jobs.finalizeSealedEnqueue:${access.authed.user._id}`, limit: 120, windowMs: 60_000 });
    return await finalizeSealedEnqueueInternalHandler(ctx, params);
  },
});

async function finalizeSealedEnqueueInternalHandler(
  ctx: MutationCtx,
  params: {
    projectId: Id<"projects">;
    jobId: Id<"jobs">;
    kind: string;
    sealedInputB64: string;
    sealedInputAlg: string;
    sealedInputKeyId: string;
  },
): Promise<{ jobId: Id<"jobs">; runId: Id<"runs"> }> {
  const job = await ctx.db.get(params.jobId);
  if (!job || job.projectId !== params.projectId) fail("not_found", "job not found");
  if (job.status !== "sealed_pending") fail("conflict", "job is not awaiting sealed input");
  if (typeof job.sealedPendingExpiresAt === "number" && job.sealedPendingExpiresAt <= Date.now()) {
    fail("conflict", "sealed-input reservation expired");
  }
  const normalizedKind = ensureSafeJobKind(params.kind);
  if (job.kind !== normalizedKind) fail("conflict", "job kind mismatch");
  const normalizedAlg = ensureBoundedString(params.sealedInputAlg, "sealedInputAlg", CONTROL_PLANE_LIMITS.hash);
  const normalizedKeyId = ensureBoundedString(params.sealedInputKeyId, "sealedInputKeyId", CONTROL_PLANE_LIMITS.hash);
  if (normalizedAlg !== SEALED_INPUT_ALG) fail("conflict", "sealedInputAlg mismatch");
  if (job.sealedInputAlg && job.sealedInputAlg !== normalizedAlg) fail("conflict", "sealedInputAlg mismatch");
  if (job.sealedInputKeyId && job.sealedInputKeyId !== normalizedKeyId) {
    fail("conflict", "sealed-input key changed, retry reserve/finalize");
  }
  const normalizedCiphertext = validateSealedInputB64(params.sealedInputB64);
  await ctx.db.patch(params.jobId, {
    status: "queued",
    sealedInputB64: normalizedCiphertext,
    sealedInputAlg: normalizedAlg,
    sealedInputKeyId: normalizedKeyId,
    sealedPendingExpiresAt: undefined,
  });
  await ctx.db.patch(job.runId, {
    status: "queued",
    finishedAt: undefined,
    errorMessage: undefined,
  });
  return { jobId: params.jobId, runId: job.runId };
}

export async function __test_finalizeSealedEnqueueInternalHandler(
  ctx: MutationCtx,
  params: {
    projectId: Id<"projects">;
    jobId: Id<"jobs">;
    kind: string;
    sealedInputB64: string;
    sealedInputAlg: string;
    sealedInputKeyId: string;
  },
) {
  return await finalizeSealedEnqueueInternalHandler(ctx, params);
}

export const cancel = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) fail("not_found", "job not found");
    const access = await requireProjectAccessMutation(ctx, job.projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `jobs.cancel:${access.authed.user._id}`, limit: 60, windowMs: 60_000 });

    if (isTerminalJobStatus(job.status)) {
      fail("conflict", "job already terminal");
    }
    const now = Date.now();
    await ctx.db.patch(jobId, {
      ...cancelJobPatch(now),
      sealedInputB64: undefined,
      sealedPendingExpiresAt: undefined,
    });
    await ctx.db.patch(job.runId, cancelRunPatch(now));
    return null;
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(JobStatusArg),
    limit: v.optional(v.number()),
  },
  returns: v.array(JobDoc),
  handler: async (ctx, { projectId, status, limit }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const max = Math.max(1, Math.min(ListLimit, Math.trunc(limit ?? 50)));
    if (status) {
      return await ctx.db
        .query("jobs")
        .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", status))
        .order("desc")
        .take(max);
    }
    return await ctx.db
      .query("jobs")
      .withIndex("by_project_createdAt", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(max);
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  returns: v.union(JobDoc, v.null()),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    await requireProjectAccessQuery(ctx, job.projectId);
    return job;
  },
});

export const takeCommandResult = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.id("jobs"),
  },
  returns: v.union(
    v.object({
      runId: v.id("runs"),
      resultJson: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { projectId, jobId }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `jobs.takeCommandResult:${access.authed.user._id}`, limit: 240, windowMs: 60_000 });
    const job = await ctx.db.get(jobId);
    if (!job || job.projectId !== projectId) fail("not_found", "job not found");
    const now = Date.now();
    await purgeExpiredRunnerCommandResults(ctx, now);
    const rows = await ctx.db
      .query("runnerCommandResults")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    if (rows.length === 0) return null;
    const newest = [...rows]
      .filter((row) => row.projectId === projectId && row.runId === job.runId && row.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (!newest) return null;
    return {
      runId: newest.runId,
      resultJson: newest.resultJson,
    };
  },
});

export const takeCommandResultBlobUrl = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.id("jobs"),
  },
  returns: v.union(
    v.object({
      runId: v.id("runs"),
      url: v.string(),
      sizeBytes: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { projectId, jobId }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `jobs.takeCommandResultBlobUrl:${access.authed.user._id}`,
      limit: 240,
      windowMs: 60_000,
    });
    const job = await ctx.db.get(jobId);
    if (!job || job.projectId !== projectId) fail("not_found", "job not found");
    const now = Date.now();
    await purgeExpiredRunnerCommandResultBlobs(ctx, now);
    const rows = await ctx.db
      .query("runnerCommandResultBlobs")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    if (rows.length === 0) return null;
    const newest = [...rows]
      .filter((row) => row.projectId === projectId && row.runId === job.runId && row.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    for (const row of rows) {
      if (newest && row._id === newest._id) continue;
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        // best effort cleanup
      }
      await ctx.db.delete(row._id);
    }
    if (!newest) return null;
    const url = await ctx.storage.getUrl(newest.storageId);
    if (!url) {
      await ctx.db.delete(newest._id);
      return null;
    }
    return {
      runId: newest.runId,
      url,
      sizeBytes: newest.sizeBytes,
    };
  },
});

export const purgeExpiredCommandResultsInternal = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const max = Math.max(1, Math.min(500, Math.trunc(limit ?? 100)));
    const deletedJson = await purgeExpiredRunnerCommandResults(ctx, now, max);
    const deletedBlobs = await purgeExpiredRunnerCommandResultBlobs(ctx, now, max);
    return { deleted: deletedJson + deletedBlobs };
  },
});

const RunnerTerminalStatus = v.union(v.literal("succeeded"), v.literal("failed"), v.literal("canceled"));

export function resolveProjectStatusFromRunCompletion(params: {
  runKind: string;
  status: "succeeded" | "failed" | "canceled";
}): "ready" | "error" | null {
  if (params.runKind !== "project_init" && params.runKind !== "project_import") return null;
  return params.status === "succeeded" ? "ready" : "error";
}

export function resolveProjectStatusPatchOnRunCompletion(params: {
  projectStatus: string;
  runKind: string;
  status: "succeeded" | "failed" | "canceled";
}): "ready" | "error" | null {
  if (params.projectStatus !== "creating") return null;
  return resolveProjectStatusFromRunCompletion({ runKind: params.runKind, status: params.status });
}

async function markRunQueued(ctx: MutationCtx, runId: Id<"runs">): Promise<void> {
  await ctx.db.patch(runId, {
    status: "queued",
    finishedAt: undefined,
    errorMessage: undefined,
  });
}

async function markJobFailedAttemptCap(
  ctx: MutationCtx,
  job: Pick<Doc<"jobs">, "_id" | "runId" | "attempt">,
): Promise<void> {
  const now = Date.now();
  const errorMessage = `attempt cap exceeded (${job.attempt}/${MAX_JOB_ATTEMPTS})`;
  await ctx.db.patch(job._id, {
    status: "failed",
    finishedAt: now,
    leaseId: undefined,
    leasedByRunnerId: undefined,
    leaseExpiresAt: undefined,
    errorMessage,
    payload: undefined,
    sealedInputB64: undefined,
    sealedPendingExpiresAt: undefined,
  });
  await ctx.db.patch(job.runId, {
    status: "failed",
    finishedAt: now,
    errorMessage,
  });
}

async function markSealedPendingExpired(
  ctx: MutationCtx,
  job: Pick<Doc<"jobs">, "_id" | "runId">,
): Promise<void> {
  const now = Date.now();
  const errorMessage = "sealed-input reservation expired before finalize";
  await ctx.db.patch(job._id, {
    status: "failed",
    finishedAt: now,
    errorMessage,
    payload: undefined,
    sealedInputB64: undefined,
    sealedPendingExpiresAt: undefined,
  });
  await ctx.db.patch(job.runId, {
    status: "failed",
    finishedAt: now,
    errorMessage,
  });
}

export const __test_orderLeaseCandidates = orderLeaseCandidateIds;

async function leaseNextInternalHandler(
  ctx: MutationCtx,
  params: {
    projectId: Id<"projects">;
    runnerId: Id<"runners">;
    leaseTtlMs?: number;
  },
) {
  const { projectId, runnerId, leaseTtlMs } = params;
  const ttl = Math.max(5_000, Math.min(120_000, Math.trunc(leaseTtlMs ?? 30_000)));
  const now = Date.now();
  const staleSealedPending = await ctx.db
    .query("jobs")
    .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "sealed_pending"))
    .take(50);
  for (const row of staleSealedPending) {
    if (typeof row.sealedPendingExpiresAt === "number" && row.sealedPendingExpiresAt <= now) {
      await markSealedPendingExpired(ctx, row);
    }
  }
  const staleLeased = await ctx.db
    .query("jobs")
    .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "leased"))
    .take(50);
  for (const row of staleLeased) {
    if (typeof row.leaseExpiresAt === "number" && row.leaseExpiresAt <= now) {
      await ctx.db.patch(row._id, {
        status: "queued",
        leaseId: undefined,
        leasedByRunnerId: undefined,
        leaseExpiresAt: undefined,
      });
      await markRunQueued(ctx, row.runId);
    }
  }
  const staleRunning = await ctx.db
    .query("jobs")
    .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "running"))
    .take(50);
  for (const row of staleRunning) {
    if (typeof row.leaseExpiresAt === "number" && row.leaseExpiresAt <= now) {
      await ctx.db.patch(row._id, {
        status: "queued",
        leaseId: undefined,
        leasedByRunnerId: undefined,
        leaseExpiresAt: undefined,
      });
      await markRunQueued(ctx, row.runId);
    }
  }

  const targetedCandidates = sortByCreatedAtAsc(
    await ctx.db
      .query("jobs")
      .withIndex("by_project_status_targetRunner_createdAt", (q) =>
        q.eq("projectId", projectId).eq("status", "queued").eq("targetRunnerId", runnerId),
      )
      .take(LEASE_WINDOW_SIZE),
  );
  const untargetedCandidates = sortByCreatedAtAsc(
    await ctx.db
      .query("jobs")
      .withIndex("by_project_status_targetRunner_createdAt", (q) =>
        q.eq("projectId", projectId).eq("status", "queued").eq("targetRunnerId", undefined),
      )
      .take(LEASE_WINDOW_SIZE),
  );
  let targetedIdx = 0;
  let untargetedIdx = 0;
  while (targetedIdx < targetedCandidates.length || untargetedIdx < untargetedCandidates.length) {
    const nextTargeted = targetedCandidates[targetedIdx];
    const nextUntargeted = untargetedCandidates[untargetedIdx];
    const next =
      nextTargeted && (!nextUntargeted || nextTargeted.createdAt <= nextUntargeted.createdAt)
        ? nextTargeted
        : nextUntargeted;
    if (!next) break;
    if (nextTargeted && next === nextTargeted) targetedIdx += 1;
    else untargetedIdx += 1;
    if (next.targetRunnerId && next.targetRunnerId !== runnerId) continue;
    if (next.sealedInputRequired && !next.sealedInputB64) {
      await markSealedPendingExpired(ctx, next);
      continue;
    }
    if (next.attempt >= MAX_JOB_ATTEMPTS) {
      await markJobFailedAttemptCap(ctx, next);
      continue;
    }
    const leaseId = globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random()}`;
    const leaseExpiresAt = now + ttl;
    await ctx.db.patch(next._id, {
      status: "leased",
      leaseId,
      leasedByRunnerId: runnerId,
      leaseExpiresAt,
      attempt: next.attempt + 1,
      startedAt: next.startedAt ?? now,
    });
    await ctx.db.patch(next.runId, { status: "running", startedAt: now });
    return {
      jobId: next._id,
      runId: next.runId,
      leaseId,
      leaseExpiresAt,
      kind: next.kind,
      targetRunnerId: next.targetRunnerId,
      sealedInputB64: next.sealedInputB64,
      sealedInputAlg: next.sealedInputAlg,
      sealedInputKeyId: next.sealedInputKeyId,
      sealedInputRequired: next.sealedInputRequired,
      payloadMeta: next.payload,
      attempt: next.attempt + 1,
    };
  }
  return null;
}

export async function __test_leaseNextInternalHandler(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    runnerId: Id<"runners">;
    leaseTtlMs?: number;
  },
) {
  return await leaseNextInternalHandler(ctx, args);
}

export const leaseNextInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    runnerId: v.id("runners"),
    leaseTtlMs: v.optional(v.number()),
  },
  returns: v.union(
    v.object({
      jobId: v.id("jobs"),
      runId: v.id("runs"),
      leaseId: v.string(),
      leaseExpiresAt: v.number(),
      kind: v.string(),
      targetRunnerId: v.optional(v.id("runners")),
      sealedInputB64: v.optional(v.string()),
      sealedInputAlg: v.optional(v.string()),
      sealedInputKeyId: v.optional(v.string()),
      sealedInputRequired: v.optional(v.boolean()),
      payloadMeta: v.optional(JobPayloadMeta),
      attempt: v.number(),
    }),
    v.null(),
  ),
  handler: leaseNextInternalHandler,
});

export const heartbeatInternal = internalMutation({
  args: { jobId: v.id("jobs"), leaseId: v.string(), leaseTtlMs: v.optional(v.number()) },
  returns: v.object({ ok: v.boolean(), status: JobStatusArg }),
  handler: async (ctx, { jobId, leaseId, leaseTtlMs }) => {
    const ttl = Math.max(5_000, Math.min(120_000, Math.trunc(leaseTtlMs ?? 30_000)));
    const now = Date.now();
    const job = await ctx.db.get(jobId);
    const gate = canCompleteJob({ job, leaseId, now });
    if (!gate.ok) return gate;
    await ctx.db.patch(jobId, {
      status: "running",
      leaseExpiresAt: now + ttl,
    });
    return { ok: true, status: "running" };
  },
});

export const completeInternal = internalMutation({
  args: {
    jobId: v.id("jobs"),
    leaseId: v.string(),
    status: RunnerTerminalStatus,
    errorMessage: v.optional(v.string()),
    commandResultJson: v.optional(v.string()),
    commandResultLargeStorageId: v.optional(v.id("_storage")),
    commandResultLargeSizeBytes: v.optional(v.number()),
  },
  returns: v.object({ ok: v.boolean(), status: JobStatusArg }),
  handler: async (
    ctx,
    {
      jobId,
      leaseId,
      status,
      errorMessage,
      commandResultJson,
      commandResultLargeStorageId,
      commandResultLargeSizeBytes,
    },
  ) => {
    const job = await ctx.db.get(jobId);
    const now = Date.now();
    const gate = canCompleteJob({ job, leaseId, now });
    if (!gate.ok) return gate;
    if (!job) return { ok: false, status: "failed" };
    const normalizedCommandResultJson =
      typeof commandResultJson === "string" && commandResultJson.trim() ? commandResultJson.trim() : undefined;
    const largeStorageId = commandResultLargeStorageId;
    const hasLargeCommandResult = Boolean(largeStorageId);
    const normalizedLargeSizeBytes =
      typeof commandResultLargeSizeBytes === "number" ? Math.trunc(commandResultLargeSizeBytes) : undefined;
    if (normalizedCommandResultJson && hasLargeCommandResult) {
      fail("conflict", "command result payload conflict");
    }
    if (!hasLargeCommandResult && normalizedLargeSizeBytes !== undefined) {
      fail("conflict", "commandResultLargeStorageId required");
    }
    if (hasLargeCommandResult && (!normalizedLargeSizeBytes || normalizedLargeSizeBytes <= 0)) {
      fail("conflict", "commandResultLargeSizeBytes invalid");
    }
    if (normalizedLargeSizeBytes && normalizedLargeSizeBytes > RUNNER_COMMAND_RESULT_BLOB_MAX_BYTES) {
      fail("conflict", "commandResultLargeJson too large");
    }
    await ctx.db.patch(jobId, {
      status,
      finishedAt: now,
      errorMessage:
        status === "failed"
          ? sanitizeErrorMessage(errorMessage ?? "job failed", "job failed")
          : undefined,
      payload: undefined,
      sealedInputB64: undefined,
      sealedPendingExpiresAt: undefined,
      leaseId: undefined,
      leaseExpiresAt: undefined,
    });
    if (status === "succeeded" && (normalizedCommandResultJson || hasLargeCommandResult)) {
      try {
        await purgeExpiredRunnerCommandResults(ctx, now);
        await purgeExpiredRunnerCommandResultBlobs(ctx, now);
        if (normalizedCommandResultJson) {
          await putRunnerCommandResult({
            ctx,
            projectId: job.projectId,
            runId: job.runId,
            jobId: job._id,
            commandResultJson: normalizedCommandResultJson,
            now,
          });
        }
        if (largeStorageId && normalizedLargeSizeBytes) {
          await putRunnerCommandResultBlob({
            ctx,
            projectId: job.projectId,
            runId: job.runId,
            jobId: job._id,
            storageId: largeStorageId,
            sizeBytes: normalizedLargeSizeBytes,
            now,
          });
        }
      } catch (err) {
        console.error(
          `jobs.completeInternal commandResult ignored: ${String((err as Error)?.message || err)}`,
        );
      }
    }
    await ctx.db.patch(job.runId, {
      status,
      finishedAt: now,
      errorMessage:
        status === "failed"
          ? sanitizeErrorMessage(errorMessage ?? "job failed", "job failed")
          : undefined,
    });
    const [run, project] = await Promise.all([ctx.db.get(job.runId), ctx.db.get(job.projectId)]);
    const projectStatus =
      run && project
        ? resolveProjectStatusPatchOnRunCompletion({
            projectStatus: project.status,
            runKind: run.kind,
            status,
          })
        : null;
    if (projectStatus) {
      await ctx.db.patch(job.projectId, {
        status: projectStatus,
        updatedAt: now,
      });
    }
    return { ok: true, status };
  },
});
