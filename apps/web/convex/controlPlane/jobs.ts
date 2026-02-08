import { JOB_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
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

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const ListLimit = 200;
const MAX_JOB_ATTEMPTS = 25;

const JobStatusArg = v.union(...literals(JOB_STATUSES));

export const enqueue = mutation({
  args: {
    projectId: v.id("projects"),
    runId: v.optional(v.id("runs")),
    kind: v.string(),
    payloadMeta: v.optional(JobPayloadMeta),
    title: v.optional(v.string()),
    host: v.optional(v.string()),
  },
  returns: v.object({ jobId: v.id("jobs"), runId: v.id("runs") }),
  handler: async (ctx, { projectId, runId, kind, payloadMeta, title, host }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `jobs.enqueue:${access.authed.user._id}`, limit: 60, windowMs: 60_000 });

    const normalizedKind = ensureBoundedString(kind, "kind", CONTROL_PLANE_LIMITS.jobKind);
    if (payloadMeta) assertNoSecretLikeKeys(payloadMeta, "payloadMeta");
    const now = Date.now();

    let nextRunId = runId;
    if (nextRunId) {
      const existingRun = await ctx.db.get(nextRunId);
      if (!existingRun) fail("not_found", "run not found");
      if (existingRun.projectId !== projectId) fail("conflict", "run does not belong to project");
      await ctx.db.patch(nextRunId, {
        status: "queued",
        errorMessage: undefined,
        finishedAt: undefined,
      });
    } else {
      nextRunId = await ctx.db.insert("runs", {
        projectId,
        kind: resolveRunKind(normalizedKind),
        status: "queued",
        title: ensureOptionalBoundedString(title, "title", CONTROL_PLANE_LIMITS.jobKind),
        host: ensureOptionalBoundedString(host, "host", CONTROL_PLANE_LIMITS.hostName),
        initiatedByUserId: access.authed.user._id,
        createdAt: now,
        startedAt: now,
      });
    }

    const payloadHash = payloadMeta ? await sha256Hex(JSON.stringify(payloadMeta)) : undefined;
    const jobId = await ctx.db.insert("jobs", {
      projectId,
      runId: nextRunId,
      kind: normalizedKind,
      status: "queued",
      payload: payloadMeta,
      payloadHash,
      attempt: 0,
      createdAt: now,
    });

    return { jobId, runId: nextRunId };
  },
});

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
    await ctx.db.patch(jobId, cancelJobPatch(now));
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

const RunnerTerminalStatus = v.union(v.literal("succeeded"), v.literal("failed"), v.literal("canceled"));

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
  });
  await ctx.db.patch(job.runId, {
    status: "failed",
    finishedAt: now,
    errorMessage,
  });
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
      payloadMeta: v.optional(JobPayloadMeta),
      attempt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { projectId, runnerId, leaseTtlMs }) => {
    const ttl = Math.max(5_000, Math.min(120_000, Math.trunc(leaseTtlMs ?? 30_000)));
    const now = Date.now();
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

    const candidates = (await ctx.db
      .query("jobs")
      .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "queued"))
      .take(25))
      .toSorted((a, b) => a.createdAt - b.createdAt);
    if (candidates.length === 0) return null;
    for (const next of candidates) {
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
        payloadMeta: next.payload,
        attempt: next.attempt + 1,
      };
    }
    return null;
  },
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
  },
  returns: v.object({ ok: v.boolean(), status: JobStatusArg }),
  handler: async (ctx, { jobId, leaseId, status, errorMessage }) => {
    const job = await ctx.db.get(jobId);
    const now = Date.now();
    const gate = canCompleteJob({ job, leaseId, now });
    if (!gate.ok) return gate;
    if (!job) return { ok: false, status: "failed" };
    await ctx.db.patch(jobId, {
      status,
      finishedAt: now,
      errorMessage:
        status === "failed"
          ? sanitizeErrorMessage(errorMessage ?? "job failed", "job failed")
          : undefined,
      payload: undefined,
      leaseId: undefined,
      leaseExpiresAt: undefined,
    });
    await ctx.db.patch(job.runId, {
      status,
      finishedAt: now,
      errorMessage:
        status === "failed"
          ? sanitizeErrorMessage(errorMessage ?? "job failed", "job failed")
          : undefined,
    });
    return { ok: true, status };
  },
});
