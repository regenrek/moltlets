import { RUNNER_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
import { v } from "convex/values";

import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "./lib/auth";
import { ensureBoundedString, ensureOptionalBoundedString, CONTROL_PLANE_LIMITS } from "./lib/controlPlane";
import { rateLimit } from "./lib/rateLimit";
import { RunnerDoc } from "./lib/validators";
import { RunnerCapabilities } from "./schema";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const HeartbeatPatch = v.object({
  version: v.optional(v.string()),
  capabilities: v.optional(RunnerCapabilities),
  status: v.optional(v.union(...literals(RUNNER_STATUSES))),
});

async function upsertHeartbeatInternalDb(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runnerName: string;
  patch: {
    version?: string;
    capabilities?: {
      supportsLocalSecretsSubmit?: boolean;
      supportsInteractiveSecrets?: boolean;
      supportsInfraApply?: boolean;
      localSecretsPort?: number;
      localSecretsNonce?: string;
    };
    status?: string;
  };
}): Promise<Id<"runners">> {
  const now = Date.now();
  const name = ensureBoundedString(params.runnerName, "runnerName", CONTROL_PLANE_LIMITS.runnerName);
  const nextStatus = params.patch.status === "offline" ? "offline" : "online";
  const existing = await params.ctx.db
    .query("runners")
    .withIndex("by_project_runner", (q) => q.eq("projectId", params.projectId).eq("runnerName", name))
    .unique();
  const next = {
    lastSeenAt: now,
    lastStatus: nextStatus,
    version: ensureOptionalBoundedString(params.patch.version, "patch.version", CONTROL_PLANE_LIMITS.hash),
    capabilities: params.patch.capabilities,
  };
  if (existing) {
    await params.ctx.db.patch(existing._id, next);
    return existing._id;
  }
  return await params.ctx.db.insert("runners", { projectId: params.projectId, runnerName: name, ...next });
}

export const upsertHeartbeat = mutation({
  args: {
    projectId: v.id("projects"),
    runnerName: v.string(),
    patch: HeartbeatPatch,
  },
  returns: v.object({ runnerId: v.id("runners") }),
  handler: async (ctx, { projectId, runnerName, patch }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `runners.upsertHeartbeat:${access.authed.user._id}`,
      limit: 240,
      windowMs: 60_000,
    });

    const runnerId = await upsertHeartbeatInternalDb({ ctx, projectId, runnerName, patch });
    return { runnerId };
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(RunnerDoc),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("runners")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.sort((a, b) => a.runnerName.localeCompare(b.runnerName));
  },
});

export const upsertHeartbeatInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    runnerName: v.string(),
    patch: HeartbeatPatch,
  },
  returns: v.object({ runnerId: v.id("runners") }),
  handler: async (ctx, { projectId, runnerName, patch }) => {
    const runnerId = await upsertHeartbeatInternalDb({ ctx, projectId, runnerName, patch });
    return { runnerId };
  },
});

export const getByIdInternal = internalQuery({
  args: { runnerId: v.id("runners") },
  returns: v.union(
    v.object({
      runnerId: v.id("runners"),
      projectId: v.id("projects"),
      runnerName: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { runnerId }) => {
    const row = await ctx.db.get(runnerId);
    if (!row) return null;
    return {
      runnerId: row._id,
      projectId: row.projectId,
      runnerName: row.runnerName,
    };
  },
});
