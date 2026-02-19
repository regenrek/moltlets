import { v } from "convex/values";

import { internal } from "../_generated/api";
import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuthQuery, requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import { ProjectDeletionStage } from "../schema";
import {
  canReadDeleteStatusAfterProjectRemoval,
  type DeleteStage,
  hasActiveLease,
  isDeleteTokenValid,
  nextStage,
  randomToken,
  sha256Hex,
} from "./projectErasureHelpers";

const DELETE_BATCH_SIZE = 200;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const LEASE_TTL_MS = 60 * 1000;
const JOB_STEP_DELAY_MS = 500;

async function deleteBatchFromProjectIndex(params: {
  ctx: MutationCtx;
  table: "runEvents" | "auditLogs";
  projectId: Id<"projects">;
}): Promise<{ deleted: number; complete: boolean }> {
  const docs = await params.ctx.db
    .query(params.table)
    .withIndex("by_project_ts", (q) => q.eq("projectId", params.projectId))
    .take(DELETE_BATCH_SIZE);
  for (const doc of docs) {
    await params.ctx.db.delete(doc._id);
  }
  return { deleted: docs.length, complete: docs.length < DELETE_BATCH_SIZE };
}

async function deleteBatchByProject(params: {
  ctx: MutationCtx;
  table:
    | "providers"
    | "projectPolicies"
    | "projectDeletionTokens"
    | "hosts"
    | "gateways"
    | "secretWiring"
    | "jobs"
    | "runnerCommandResultBlobs"
    | "runnerCommandResults"
    | "runnerTokens"
    | "runners"
    | "projectCredentials";
  projectId: Id<"projects">;
}): Promise<{ deleted: number; complete: boolean }> {
  const docs = await params.ctx.db
    .query(params.table)
    .withIndex("by_project", (q) => q.eq("projectId", params.projectId))
    .take(DELETE_BATCH_SIZE);
  for (const doc of docs) {
    await params.ctx.db.delete(doc._id);
  }
  return { deleted: docs.length, complete: docs.length < DELETE_BATCH_SIZE };
}

async function deleteBatchRunnerCommandResultBlobs(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
}): Promise<{ deleted: number; complete: boolean }> {
  const docs = await params.ctx.db
    .query("runnerCommandResultBlobs")
    .withIndex("by_project", (q) => q.eq("projectId", params.projectId))
    .take(DELETE_BATCH_SIZE);
  for (const doc of docs) {
    try {
      await params.ctx.storage.delete(doc.storageId);
    } catch {
      // best effort cleanup
    }
    await params.ctx.db.delete(doc._id);
  }
  return { deleted: docs.length, complete: docs.length < DELETE_BATCH_SIZE };
}

async function deleteBatchRuns(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
}): Promise<{ deleted: number; complete: boolean }> {
  const docs = await params.ctx.db
    .query("runs")
    .withIndex("by_project_startedAt", (q) => q.eq("projectId", params.projectId))
    .take(DELETE_BATCH_SIZE);
  for (const doc of docs) {
    await params.ctx.db.delete(doc._id);
  }
  return { deleted: docs.length, complete: docs.length < DELETE_BATCH_SIZE };
}

async function deleteBatchProjectConfigs(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
}): Promise<{ deleted: number; complete: boolean }> {
  const docs = await params.ctx.db
    .query("projectConfigs")
    .withIndex("by_project_type", (q) => q.eq("projectId", params.projectId))
    .take(DELETE_BATCH_SIZE);
  for (const doc of docs) {
    await params.ctx.db.delete(doc._id);
  }
  return { deleted: docs.length, complete: docs.length < DELETE_BATCH_SIZE };
}

async function deleteBatchProjectMembers(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
}): Promise<{ deleted: number; complete: boolean }> {
  const docs = await params.ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (q) => q.eq("projectId", params.projectId))
    .take(DELETE_BATCH_SIZE);
  for (const doc of docs) {
    await params.ctx.db.delete(doc._id);
  }
  return { deleted: docs.length, complete: docs.length < DELETE_BATCH_SIZE };
}

async function deleteProjectDoc(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
}): Promise<{ deleted: number; complete: boolean }> {
  const doc = await params.ctx.db.get(params.projectId);
  if (!doc) return { deleted: 0, complete: true };
  await params.ctx.db.delete(params.projectId);
  return { deleted: 1, complete: true };
}

async function deleteStageBatch(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  stage: DeleteStage;
}): Promise<{ deleted: number; complete: boolean }> {
  switch (params.stage) {
    case "runEvents":
      return await deleteBatchFromProjectIndex({ ctx: params.ctx, table: "runEvents", projectId: params.projectId });
    case "runs":
      return await deleteBatchRuns(params);
    case "providers":
      return await deleteBatchByProject({ ctx: params.ctx, table: "providers", projectId: params.projectId });
    case "projectConfigs":
      return await deleteBatchProjectConfigs(params);
    case "hosts":
      return await deleteBatchByProject({ ctx: params.ctx, table: "hosts", projectId: params.projectId });
    case "gateways":
      return await deleteBatchByProject({ ctx: params.ctx, table: "gateways", projectId: params.projectId });
    case "secretWiring":
      return await deleteBatchByProject({ ctx: params.ctx, table: "secretWiring", projectId: params.projectId });
    case "jobs":
      return await deleteBatchByProject({ ctx: params.ctx, table: "jobs", projectId: params.projectId });
    case "runnerCommandResultBlobs":
      return await deleteBatchRunnerCommandResultBlobs(params);
    case "runnerCommandResults":
      return await deleteBatchByProject({ ctx: params.ctx, table: "runnerCommandResults", projectId: params.projectId });
    case "runnerTokens":
      return await deleteBatchByProject({ ctx: params.ctx, table: "runnerTokens", projectId: params.projectId });
    case "runners":
      return await deleteBatchByProject({ ctx: params.ctx, table: "runners", projectId: params.projectId });
    case "projectCredentials":
      return await deleteBatchByProject({ ctx: params.ctx, table: "projectCredentials", projectId: params.projectId });
    case "projectMembers":
      return await deleteBatchProjectMembers(params);
    case "auditLogs":
      return await deleteBatchFromProjectIndex({ ctx: params.ctx, table: "auditLogs", projectId: params.projectId });
    case "projectPolicies":
      return await deleteBatchByProject({ ctx: params.ctx, table: "projectPolicies", projectId: params.projectId });
    case "projectDeletionTokens":
      return await deleteBatchByProject({ ctx: params.ctx, table: "projectDeletionTokens", projectId: params.projectId });
    case "project":
      return await deleteProjectDoc(params);
    case "done":
      return { deleted: 0, complete: true };
    default:
      return { deleted: 0, complete: true };
  }
}

export const deleteStart = mutation({
  args: { projectId: v.id("projects") },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { projectId }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `project.delete.start:${access.authed.user._id}`,
      limit: 10,
      windowMs: 60_000,
    });

    const now = Date.now();
    const expiresAt = now + TOKEN_TTL_MS;
    const token = randomToken();
    const tokenHash = await sha256Hex(token);

    const existing = await ctx.db
      .query("projectDeletionTokens")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    await ctx.db.insert("projectDeletionTokens", {
      projectId,
      tokenHash,
      createdByUserId: access.authed.user._id,
      createdAt: now,
      expiresAt,
    });

    await ctx.db.insert("auditLogs", {
      ts: now,
      userId: access.authed.user._id,
      projectId,
      action: "project.delete.start",
      target: { projectId },
      data: { tokenExpiresAt: expiresAt },
    });

    return { token, expiresAt };
  },
});

export const deleteConfirm = mutation({
  args: {
    projectId: v.id("projects"),
    token: v.string(),
    confirmation: v.string(),
  },
  returns: v.object({ jobId: v.id("projectDeletionJobs") }),
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `project.delete.confirm:${access.authed.user._id}`,
      limit: 10,
      windowMs: 60_000,
    });

    const expected = `delete ${access.project.name}`;
    if (args.confirmation.trim() !== expected) {
      fail("conflict", "confirmation mismatch");
    }

    const now = Date.now();
    const tokenHash = await sha256Hex(args.token.trim());
    const tokens = await ctx.db
      .query("projectDeletionTokens")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const valid = isDeleteTokenValid({ tokens, now, tokenHash });
    if (!valid) fail("conflict", "invalid or expired delete token");

    const running = await ctx.db
      .query("projectDeletionJobs")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "running"))
      .take(1);
    if (running.length > 0) fail("conflict", "project deletion already running");
    const pending = await ctx.db
      .query("projectDeletionJobs")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "pending"))
      .take(1);
    if (pending.length > 0) fail("conflict", "project deletion already pending");

    const jobId = await ctx.db.insert("projectDeletionJobs", {
      projectId: args.projectId,
      requestedByUserId: access.authed.user._id,
      status: "pending",
      stage: "runEvents",
      processed: 0,
      createdAt: now,
      updatedAt: now,
    });

    for (const row of tokens) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert("auditLogs", {
      ts: now,
      userId: access.authed.user._id,
      projectId: args.projectId,
      action: "project.delete.confirm",
      target: { projectId: args.projectId },
      data: { deletionJobId: jobId },
    });

    await ctx.scheduler.runAfter(JOB_STEP_DELAY_MS, internal.controlPlane.projectErasure.runDeletionJobStep, { jobId });
    return { jobId };
  },
});

export const deleteStatus = query({
  args: { jobId: v.id("projectDeletionJobs") },
  returns: v.union(
    v.object({
      jobId: v.id("projectDeletionJobs"),
      projectId: v.id("projects"),
      status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
      stage: ProjectDeletionStage,
      processed: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    try {
      await requireProjectAccessQuery(ctx, job.projectId);
    } catch {
      const authed = await requireAuthQuery(ctx);
      if (
        !canReadDeleteStatusAfterProjectRemoval({
          authedRole: authed.user.role,
          authedUserId: String(authed.user._id),
          requestedByUserId: String(job.requestedByUserId),
        })
      ) {
        fail("forbidden", "project access denied");
      }
    }
    return {
      jobId: job._id,
      projectId: job.projectId,
      status: job.status,
      stage: job.stage,
      processed: job.processed,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      lastError: job.lastError,
    };
  },
});

export const isDeletionInProgressInternal = internalQuery({
  args: { projectId: v.id("projects") },
  returns: v.object({ active: v.boolean() }),
  handler: async (ctx, { projectId }) => {
    const running = await ctx.db
      .query("projectDeletionJobs")
      .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "running"))
      .take(1);
    if (running.length > 0) return { active: true };
    const pending = await ctx.db
      .query("projectDeletionJobs")
      .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "pending"))
      .take(1);
    return { active: pending.length > 0 };
  },
});

export const runDeletionJobStep = internalMutation({
  args: { jobId: v.id("projectDeletionJobs") },
  returns: v.object({
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    stage: ProjectDeletionStage,
    deleted: v.number(),
    processed: v.number(),
  }),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { status: "failed" as const, stage: "done" as const, deleted: 0, processed: 0 };
    if (job.status === "completed" || job.status === "failed") {
      const status: "completed" | "failed" = job.status === "completed" ? "completed" : "failed";
      return { status, stage: job.stage as DeleteStage, deleted: 0, processed: job.processed };
    }

    const now = Date.now();
    if (hasActiveLease(job, now)) {
      return { status: "running" as const, stage: job.stage as DeleteStage, deleted: 0, processed: job.processed };
    }

    const leaseId = randomToken();
    const leaseExpiresAt = now + LEASE_TTL_MS;
    await ctx.db.patch(jobId, {
      status: "running",
      updatedAt: now,
      lastError: undefined,
      leaseId,
      leaseExpiresAt,
    });

    try {
      const locked = await ctx.db.get(jobId);
      if (!locked) throw new Error("job not found");
      if (locked.leaseId !== leaseId) {
        return {
          status: "running" as const,
          stage: locked.stage as DeleteStage,
          deleted: 0,
          processed: locked.processed,
        };
      }

      const step = await deleteStageBatch({
        ctx,
        projectId: locked.projectId,
        stage: locked.stage as DeleteStage,
      });

      const processed = locked.processed + step.deleted;
      const stage = step.complete ? nextStage(locked.stage as DeleteStage) : (locked.stage as DeleteStage);
      const completed = stage === "done";
      const status: "pending" | "completed" = completed ? "completed" : "pending";

      await ctx.db.patch(jobId, {
        status,
        stage,
        processed,
        updatedAt: Date.now(),
        completedAt: completed ? Date.now() : undefined,
        leaseId: undefined,
        leaseExpiresAt: undefined,
      });

      if (!completed) {
        await ctx.scheduler.runAfter(JOB_STEP_DELAY_MS, internal.controlPlane.projectErasure.runDeletionJobStep, { jobId });
      }

      return { status: status as "pending" | "completed", stage, deleted: step.deleted, processed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.db.patch(jobId, {
        status: "failed",
        lastError: message,
        updatedAt: Date.now(),
        leaseId: undefined,
        leaseExpiresAt: undefined,
      });
      return { status: "failed" as const, stage: job.stage as DeleteStage, deleted: 0, processed: job.processed };
    }
  },
});
