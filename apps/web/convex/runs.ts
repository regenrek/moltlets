import { RUN_KINDS, RUN_STATUSES } from "@clawlets/core/lib/runtime/run-constants";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "./lib/auth";
import { rateLimit } from "./lib/rateLimit";
import { ProjectDoc, RunDoc } from "./lib/validators";
import { Role } from "./schema";
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const RunKind = v.union(...literals(RUN_KINDS));
const RunStatus = v.union(...literals(RUN_STATUSES));

export const listByProjectPage = query({
  args: { projectId: v.id("projects"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(RunDoc),
  handler: async (ctx, { projectId, paginationOpts }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const numItems = Math.max(1, Math.min(200, paginationOpts.numItems));
    return await ctx.db
      .query("runs")
      .withIndex("by_project_startedAt", (q) => q.eq("projectId", projectId))
      .order("desc")
      .paginate({ ...paginationOpts, numItems });
  },
});

export const listByProjectHostPage = query({
  args: {
    projectId: v.id("projects"),
    host: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(RunDoc),
  handler: async (ctx, { projectId, host, paginationOpts }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const numItems = Math.max(1, Math.min(200, paginationOpts.numItems));
    const normalizedHost = host.trim();
    return await ctx.db
      .query("runs")
      .withIndex("by_project_host_startedAt", (q) =>
        q.eq("projectId", projectId).eq("host", normalizedHost),
      )
      .order("desc")
      .paginate({ ...paginationOpts, numItems });
  },
});

export const latestByProjectHostKind = query({
  args: {
    projectId: v.id("projects"),
    host: v.string(),
    kind: RunKind,
  },
  returns: v.union(RunDoc, v.null()),
  handler: async (ctx, { projectId, host, kind }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const normalizedHost = host.trim();
    if (!normalizedHost) return null;

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_project_host_kind_startedAt", (q) =>
        q.eq("projectId", projectId).eq("host", normalizedHost).eq("kind", kind),
      )
      .order("desc")
      .take(1);

    return runs[0] ?? null;
  },
});
export const get = query({
  args: { runId: v.id("runs") },
  returns: v.object({ run: RunDoc, role: Role, project: ProjectDoc }),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");
    const access = await requireProjectAccessQuery(ctx, run.projectId);
    return { run, role: access.role, project: access.project };
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    kind: RunKind,
    title: v.optional(v.string()),
    host: v.optional(v.string()),
  },
  returns: v.object({ runId: v.id("runs") }),
  handler: async (ctx, { projectId, kind, title, host }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);

    await rateLimit({ ctx, key: `runs.create:${access.authed.user._id}`, limit: 30, windowMs: 60_000 });

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      projectId,
      kind,
      status: "running",
      title: title?.trim() || undefined,
      host: host?.trim() || undefined,
      initiatedByUserId: access.authed.user._id,
      createdAt: now,
      startedAt: now,
    });
    return { runId };
  },
});

export const setStatus = mutation({
  args: {
    runId: v.id("runs"),
    status: RunStatus,
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, status, errorMessage }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");

    const access = await requireProjectAccessMutation(ctx, run.projectId);
    requireAdmin(access.role);

    const now = Date.now();
    const patch: Record<string, unknown> = { status };
    if (status === "succeeded" || status === "failed" || status === "canceled") {
      patch["finishedAt"] = now;
    }
    if (typeof errorMessage === "string" && errorMessage.trim()) {
      patch["errorMessage"] = sanitizeErrorMessage(errorMessage, "run failed");
    } else if (status !== "failed") {
      patch["errorMessage"] = undefined;
    }
    await ctx.db.patch(runId, patch);
    return null;
  },
});
