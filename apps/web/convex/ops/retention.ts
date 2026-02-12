import { Base64, v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { hasActiveLease, normalizeRetentionDays } from "./retentionHelpers";

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const SWEEP_STATE_KEY = "default";
const SWEEP_BATCH_SIZE = 200;
const MAX_PROJECTS_PER_SWEEP = 25;
const GLOBAL_DELETE_BUDGET = 1000;
const PER_PROJECT_DELETE_BUDGET = 200;
const LEASE_TTL_MS = 60 * 1000;
const CONTINUE_DELAY_MS = 5_000;
const POLICY_CURSOR_PREFIX = "project:";
const POLICY_BATCH_FETCH_SIZE = MAX_PROJECTS_PER_SWEEP + 1;

type SweepStats = {
  projectsScanned: number;
  runEventsDeleted: number;
  runsDeleted: number;
  auditLogsDeleted: number;
  continued: boolean;
};

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

function encodePolicyCursor(projectId: Id<"projects">): string {
  return `${POLICY_CURSOR_PREFIX}${projectId}`;
}

function decodePolicyCursor(raw: string | undefined): Id<"projects"> | null {
  if (!raw) return null;
  if (!raw.startsWith(POLICY_CURSOR_PREFIX)) {
    throw new Error("invalid retention sweep cursor format");
  }
  const projectId = raw.slice(POLICY_CURSOR_PREFIX.length).trim();
  if (projectId.length === 0) {
    throw new Error("invalid retention sweep cursor payload");
  }
  return projectId as Id<"projects">;
}

export function __test_encodePolicyCursor(projectId: Id<"projects">): string {
  return encodePolicyCursor(projectId);
}

export function __test_decodePolicyCursor(raw: string | undefined): Id<"projects"> | null {
  return decodePolicyCursor(raw);
}

async function deleteRunEventsBeforeCutoff(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  cutoffTs: number;
  remaining: number;
}): Promise<number> {
  if (params.remaining <= 0) return 0;
  const docs = await params.ctx.db
    .query("runEvents")
    .withIndex("by_project_ts", (q) => q.eq("projectId", params.projectId).lt("ts", params.cutoffTs))
    .take(Math.min(params.remaining, SWEEP_BATCH_SIZE));
  for (const doc of docs) {
    await params.ctx.db.delete(doc._id);
  }
  return docs.length;
}

async function deleteAuditLogsBeforeCutoff(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  cutoffTs: number;
  remaining: number;
}): Promise<number> {
  if (params.remaining <= 0) return 0;
  const docs = await params.ctx.db
    .query("auditLogs")
    .withIndex("by_project_ts", (q) => q.eq("projectId", params.projectId).lt("ts", params.cutoffTs))
    .take(Math.min(params.remaining, SWEEP_BATCH_SIZE));
  for (const doc of docs) {
    await params.ctx.db.delete(doc._id);
  }
  return docs.length;
}

async function deleteRunEventsForRun(params: {
  ctx: MutationCtx;
  runId: Id<"runs">;
  budget: number;
}): Promise<{ deleted: number; done: boolean }> {
  let deleted = 0;
  while (deleted < params.budget) {
    const events = await params.ctx.db
      .query("runEvents")
      .withIndex("by_run_ts", (q) => q.eq("runId", params.runId))
      .take(Math.min(params.budget - deleted, SWEEP_BATCH_SIZE));
    if (events.length === 0) return { deleted, done: true };
    for (const ev of events) {
      await params.ctx.db.delete(ev._id);
      deleted += 1;
      if (deleted >= params.budget) break;
    }
    if (events.length < SWEEP_BATCH_SIZE) return { deleted, done: true };
  }
  return { deleted, done: false };
}

async function deleteRunsBeforeCutoff(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  cutoffTs: number;
  remaining: number;
}): Promise<{ runEventsDeleted: number; runsDeleted: number; docsDeleted: number }> {
  if (params.remaining <= 0) return { runEventsDeleted: 0, runsDeleted: 0, docsDeleted: 0 };
  let runEventsDeleted = 0;
  let runsDeleted = 0;
  let docsDeleted = 0;

  const candidates = await params.ctx.db
    .query("runs")
    .withIndex("by_project_startedAt", (q) => q.eq("projectId", params.projectId).lt("startedAt", params.cutoffTs))
    .take(Math.min(SWEEP_BATCH_SIZE * 2, params.remaining * 2));

  for (const run of candidates) {
    if (!TERMINAL_RUN_STATUSES.has(run.status)) continue;
    if (docsDeleted >= params.remaining) break;
    const budgetLeft = params.remaining - docsDeleted;
    const runEventsResult = await deleteRunEventsForRun({
      ctx: params.ctx,
      runId: run._id,
      budget: budgetLeft,
    });
    runEventsDeleted += runEventsResult.deleted;
    docsDeleted += runEventsResult.deleted;
    if (!runEventsResult.done) break;
    if (docsDeleted >= params.remaining) break;
    await params.ctx.db.delete(run._id);
    runsDeleted += 1;
    docsDeleted += 1;
  }
  return { runEventsDeleted, runsDeleted, docsDeleted };
}

export const runRetentionSweep = internalMutation({
  args: { reason: v.optional(v.string()), leaseId: v.optional(v.string()) },
  returns: v.object({
    projectsScanned: v.number(),
    runEventsDeleted: v.number(),
    runsDeleted: v.number(),
    auditLogsDeleted: v.number(),
    continued: v.boolean(),
  }),
  handler: async (ctx, args): Promise<SweepStats> => {
    const now = Date.now();
    let projectsScanned = 0;
    let runEventsDeleted = 0;
    let runsDeleted = 0;
    let auditLogsDeleted = 0;

    const sweepRows = await ctx.db
      .query("retentionSweeps")
      .withIndex("by_key", (q) => q.eq("key", SWEEP_STATE_KEY))
      .collect();
    const sweep = sweepRows[0] ?? null;

    if (sweep && hasActiveLease(sweep.leaseExpiresAt, now) && args.leaseId !== sweep.leaseId) {
      return { projectsScanned: 0, runEventsDeleted: 0, runsDeleted: 0, auditLogsDeleted: 0, continued: false };
    }

    const leaseId = sweep?.leaseId && hasActiveLease(sweep.leaseExpiresAt, now) ? sweep.leaseId : randomToken();
    const leaseExpiresAt = now + LEASE_TTL_MS;

    let sweepId: Id<"retentionSweeps">;
    if (sweep) {
      sweepId = sweep._id;
      await ctx.db.patch(sweepId, { leaseId, leaseExpiresAt, updatedAt: now });
    } else {
      sweepId = await ctx.db.insert("retentionSweeps", {
        key: SWEEP_STATE_KEY,
        cursor: undefined,
        leaseId,
        leaseExpiresAt,
        updatedAt: now,
      });
    }

    const locked = await ctx.db.get(sweepId);
    if (!locked || locked.leaseId !== leaseId) {
      return { projectsScanned: 0, runEventsDeleted: 0, runsDeleted: 0, auditLogsDeleted: 0, continued: false };
    }

    const afterProjectId = decodePolicyCursor(typeof locked.cursor === "string" ? locked.cursor : undefined);
    let remainingGlobalBudget = GLOBAL_DELETE_BUDGET;
    const policyRows = afterProjectId
      ? await ctx.db
          .query("projectPolicies")
          .withIndex("by_project", (q) => q.gt("projectId", afterProjectId))
          .take(POLICY_BATCH_FETCH_SIZE)
      : await ctx.db
          .query("projectPolicies")
          .withIndex("by_project")
          .take(POLICY_BATCH_FETCH_SIZE);
    const hasMorePolicies = policyRows.length > MAX_PROJECTS_PER_SWEEP;
    const policies = hasMorePolicies ? policyRows.slice(0, MAX_PROJECTS_PER_SWEEP) : policyRows;

    let nextCursorProjectId: Id<"projects"> | null = null;
    for (const policy of policies) {
      if (remainingGlobalBudget <= 0) break;
      projectsScanned += 1;
      nextCursorProjectId = policy.projectId;

      const retentionDays = normalizeRetentionDays(policy.retentionDays);
      const cutoffTs = now - retentionDays * 24 * 60 * 60 * 1000;

      let remainingProjectBudget = Math.min(PER_PROJECT_DELETE_BUDGET, remainingGlobalBudget);
      const runEventsCount = await deleteRunEventsBeforeCutoff({
        ctx,
        projectId: policy.projectId,
        cutoffTs,
        remaining: remainingProjectBudget,
      });
      runEventsDeleted += runEventsCount;
      remainingProjectBudget -= runEventsCount;
      remainingGlobalBudget -= runEventsCount;
      if (remainingProjectBudget <= 0 || remainingGlobalBudget <= 0) continue;

      const auditLogsCount = await deleteAuditLogsBeforeCutoff({
        ctx,
        projectId: policy.projectId,
        cutoffTs,
        remaining: remainingProjectBudget,
      });
      auditLogsDeleted += auditLogsCount;
      remainingProjectBudget -= auditLogsCount;
      remainingGlobalBudget -= auditLogsCount;
      if (remainingProjectBudget <= 0 || remainingGlobalBudget <= 0) continue;

      const runsResult = await deleteRunsBeforeCutoff({
        ctx,
        projectId: policy.projectId,
        cutoffTs,
        remaining: remainingProjectBudget,
      });
      runEventsDeleted += runsResult.runEventsDeleted;
      runsDeleted += runsResult.runsDeleted;
      remainingProjectBudget -= runsResult.docsDeleted;
      remainingGlobalBudget -= runsResult.docsDeleted;
    }

    const continued = projectsScanned < policies.length || hasMorePolicies;
    const cursor = continued && nextCursorProjectId ? encodePolicyCursor(nextCursorProjectId) : null;
    await ctx.db.patch(sweepId, {
      cursor: cursor ?? undefined,
      updatedAt: Date.now(),
      leaseId: continued ? leaseId : undefined,
      leaseExpiresAt: continued ? Date.now() + LEASE_TTL_MS : undefined,
    });

    if (continued) {
      await ctx.scheduler.runAfter(CONTINUE_DELAY_MS, internal.ops.retention.runRetentionSweep, {
        reason: "continue",
        leaseId,
      });
    }

    return {
      projectsScanned,
      runEventsDeleted,
      runsDeleted,
      auditLogsDeleted,
      continued,
    };
  },
});
