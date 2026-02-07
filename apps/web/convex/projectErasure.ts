import { Base64, v } from "convex/values";

import { internal } from "./_generated/api";
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "./lib/auth";
import { fail } from "./lib/errors";
import { rateLimit } from "./lib/rateLimit";

const DELETE_BATCH_SIZE = 200;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const LEASE_TTL_MS = 60 * 1000;
const JOB_STEP_DELAY_MS = 500;
const DELETE_STAGES = [
  "runEvents",
  "runs",
  "providers",
  "projectConfigs",
  "projectMembers",
  "auditLogs",
  "projectPolicies",
  "projectDeletionTokens",
  "project",
  "done",
] as const;

type DeleteStage = (typeof DELETE_STAGES)[number];

function nextStage(stage: DeleteStage): DeleteStage {
  const idx = DELETE_STAGES.indexOf(stage);
  if (idx < 0) return "done";
  return DELETE_STAGES[Math.min(idx + 1, DELETE_STAGES.length - 1)] as DeleteStage;
}

function randomToken(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("crypto.getRandomValues unavailable");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Base64.fromByteArray(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error("crypto.subtle.digest unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hasActiveLease(job: { leaseExpiresAt?: number | undefined }, now: number): boolean {
  const exp = job.leaseExpiresAt;
  return typeof exp === "number" && exp > now;
}

function isDeleteTokenValid(params: {
  tokens: Array<{ tokenHash: string; expiresAt: number }>;
  now: number;
  tokenHash: string;
}): boolean {
  return params.tokens.some((row) => row.expiresAt >= params.now && constantTimeEqual(row.tokenHash, params.tokenHash));
}

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
  table: "providers" | "projectPolicies" | "projectDeletionTokens";
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

    await ctx.scheduler.runAfter(JOB_STEP_DELAY_MS, internal.projectErasure.runDeletionJobStep, { jobId });
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
      stage: v.union(
        v.literal("runEvents"),
        v.literal("runs"),
        v.literal("providers"),
        v.literal("projectConfigs"),
        v.literal("projectMembers"),
        v.literal("auditLogs"),
        v.literal("projectPolicies"),
        v.literal("projectDeletionTokens"),
        v.literal("project"),
        v.literal("done"),
      ),
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
    await requireProjectAccessQuery(ctx, job.projectId);
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

export const runDeletionJobStep = internalMutation({
  args: { jobId: v.id("projectDeletionJobs") },
  returns: v.object({
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    stage: v.union(
      v.literal("runEvents"),
      v.literal("runs"),
      v.literal("providers"),
      v.literal("projectConfigs"),
      v.literal("projectMembers"),
      v.literal("auditLogs"),
      v.literal("projectPolicies"),
      v.literal("projectDeletionTokens"),
      v.literal("project"),
      v.literal("done"),
    ),
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
        await ctx.scheduler.runAfter(JOB_STEP_DELAY_MS, internal.projectErasure.runDeletionJobStep, { jobId });
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

export async function __test_sha256Hex(input: string): Promise<string> {
  return await sha256Hex(input);
}

export function __test_randomToken(): string {
  return randomToken();
}

export function __test_constantTimeEqual(a: string, b: string): boolean {
  return constantTimeEqual(a, b);
}

export function __test_hasActiveLease(leaseExpiresAt: number | undefined, now: number): boolean {
  return hasActiveLease({ leaseExpiresAt }, now);
}

export function __test_isDeleteTokenValid(params: {
  tokens: Array<{ tokenHash: string; expiresAt: number }>;
  now: number;
  tokenHash: string;
}): boolean {
  return isDeleteTokenValid(params);
}
