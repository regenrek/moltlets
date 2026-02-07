import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "./lib/auth";
import { fail } from "./lib/errors";
import { GitWritePolicy } from "./schema";

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

function normalizeRetentionDays(raw: number): number {
  if (!Number.isInteger(raw)) fail("conflict", "retentionDays must be an integer");
  if (raw < MIN_RETENTION_DAYS || raw > MAX_RETENTION_DAYS) {
    fail("conflict", `retentionDays must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`);
  }
  return raw;
}

export const getByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.object({
    projectId: v.id("projects"),
    retentionDays: v.number(),
    gitWritePolicy: GitWritePolicy,
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const existing = await ctx.db
      .query("projectPolicies")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique();
    if (existing) {
      const gitWritePolicy: "pr_only" | "direct_commit_enabled" =
        existing.gitWritePolicy === "direct_commit_enabled" ? "direct_commit_enabled" : "pr_only";
      return {
        projectId: existing.projectId,
        retentionDays: existing.retentionDays,
        gitWritePolicy,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }
    const now = Date.now();
    return {
      projectId,
      retentionDays: DEFAULT_RETENTION_DAYS,
      gitWritePolicy: "pr_only" as const,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    retentionDays: v.optional(v.number()),
    gitWritePolicy: v.optional(GitWritePolicy),
  },
  returns: v.object({
    projectId: v.id("projects"),
    retentionDays: v.number(),
    gitWritePolicy: GitWritePolicy,
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);

    const now = Date.now();
    const existing = await ctx.db
      .query("projectPolicies")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    const retentionDays = normalizeRetentionDays(
      args.retentionDays ?? existing?.retentionDays ?? DEFAULT_RETENTION_DAYS,
    );
    const gitWritePolicy: "pr_only" | "direct_commit_enabled" =
      args.gitWritePolicy ?? existing?.gitWritePolicy ?? "pr_only";

    if (existing) {
      await ctx.db.patch(existing._id, { retentionDays, gitWritePolicy, updatedAt: now });
    } else {
      await ctx.db.insert("projectPolicies", {
        projectId: args.projectId,
        retentionDays,
        gitWritePolicy,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      ts: now,
      userId: access.authed.user._id,
      projectId: args.projectId,
      action: "project.policy.update",
      target: { projectId: args.projectId },
      data: { retentionDays, gitWritePolicy },
    });

    return {
      projectId: args.projectId,
      retentionDays,
      gitWritePolicy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  },
});
