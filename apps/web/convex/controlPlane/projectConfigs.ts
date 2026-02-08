import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { ensureBoundedString, ensureOptionalBoundedString, CONTROL_PLANE_LIMITS } from "../shared/controlPlane";
import { rateLimit } from "../shared/rateLimit";
import { ProjectConfigDoc } from "../shared/validators";
import { ProjectConfigType } from "../schema";

const UpsertManyArgs = {
  projectId: v.id("projects"),
  entries: v.array(
    v.object({
      path: v.string(),
      type: ProjectConfigType,
      sha256: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
  ),
} as const;

type ProjectConfigEntryInput = {
  path: string;
  type: "fleet" | "host" | "gateway" | "provider" | "raw";
  sha256?: string;
  error?: string;
};

async function upsertManyImpl(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  entries: ProjectConfigEntryInput[],
): Promise<{ updated: number }> {
  const now = Date.now();
  let updated = 0;
  const existingRows = await ctx.db
    .query("projectConfigs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const byPath = new Map<string, { _id: Id<"projectConfigs"> }>(
    existingRows.map((row) => [row.path, { _id: row._id }]),
  );

  for (const entry of entries) {
    const path = ensureBoundedString(entry.path, "entries.path", CONTROL_PLANE_LIMITS.projectConfigPath);
    const next = {
      type: entry.type,
      path,
      lastHash: ensureOptionalBoundedString(entry.sha256, "entries.sha256", CONTROL_PLANE_LIMITS.hash),
      lastSyncAt: now,
      lastError: ensureOptionalBoundedString(entry.error, "entries.error", CONTROL_PLANE_LIMITS.errorMessage),
    };

    const existing = byPath.get(path);
    if (existing) {
      await ctx.db.patch(existing._id, next);
    } else {
      const inserted = await ctx.db.insert("projectConfigs", { projectId, ...next });
      byPath.set(path, { _id: inserted });
    }
    updated += 1;
  }

  return { updated };
}

export const upsertMany = mutation({
  args: UpsertManyArgs,
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, { projectId, entries }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `projectConfigs.upsertMany:${access.authed.user._id}`,
      limit: 60,
      windowMs: 60_000,
    });
    return await upsertManyImpl(ctx, projectId, entries);
  },
});

export const upsertManyInternal = internalMutation({
  args: UpsertManyArgs,
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, { projectId, entries }) => {
    return await upsertManyImpl(ctx, projectId, entries);
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(ProjectConfigDoc),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("projectConfigs")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.sort((a, b) => a.path.localeCompare(b.path));
  },
});
