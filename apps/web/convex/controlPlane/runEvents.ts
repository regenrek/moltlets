import { RUN_EVENT_LEVELS } from "@clawlets/core/lib/runtime/run-constants";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { rateLimit } from "../shared/rateLimit";
import { RunEventDoc } from "../shared/validators";
import { RunEventMeta } from "../schema";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const RunEventLevel = v.union(...literals(RUN_EVENT_LEVELS));

function sanitizeMeta(meta: unknown): { kind: "phase"; phase: "command_start" | "command_end" | "post_run_cleanup" | "truncated" } | { kind: "exit"; code: number } | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const value = meta as Record<string, unknown>;
  if (value.kind === "phase") {
    const phase = value.phase;
    if (
      phase === "command_start" ||
      phase === "command_end" ||
      phase === "post_run_cleanup" ||
      phase === "truncated"
    ) {
      return { kind: "phase", phase };
    }
    return undefined;
  }
  if (value.kind === "exit") {
    const code = value.code;
    if (typeof code !== "number" || !Number.isFinite(code) || !Number.isInteger(code)) return undefined;
    if (code < -1 || code > 255) return undefined;
    return { kind: "exit", code };
  }
  return undefined;
}

export const pageByRun = query({
  args: { runId: v.id("runs"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(RunEventDoc),
  handler: async (ctx, { runId, paginationOpts }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");
    await requireProjectAccessQuery(ctx, run.projectId);

    const numItems = Math.max(1, Math.min(500, paginationOpts.numItems));
    const res = await ctx.db
      .query("runEvents")
      .withIndex("by_run_ts", (q) => q.eq("runId", runId))
      .order("desc")
      .paginate({ ...paginationOpts, numItems });
    return {
      ...res,
      page: res.page.map((row) => ({
        _id: row._id,
        _creationTime: row._creationTime,
        projectId: row.projectId,
        runId: row.runId,
        ts: row.ts,
        level: row.level,
        message: row.message,
        meta: sanitizeMeta(row.meta),
        redacted: row.redacted,
      })),
    };
  },
});

export const appendBatch = mutation({
  args: {
    runId: v.id("runs"),
    events: v.array(
      v.object({
        ts: v.number(),
        level: RunEventLevel,
        message: v.string(),
        meta: v.optional(RunEventMeta),
        redacted: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { runId, events }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("run not found");
    const access = await requireProjectAccessMutation(ctx, run.projectId);
    requireAdmin(access.role);

    await rateLimit({ ctx, key: `runEvents.append:${access.authed.user._id}`, limit: 240, windowMs: 60_000 });

    const safeEvents = events.slice(0, 200);
    for (const ev of safeEvents) {
      const message = ev.message.trim();
      if (!message) continue;
      await ctx.db.insert("runEvents", {
        projectId: run.projectId,
        runId,
        ts: ev.ts,
        level: ev.level,
        message: message.length > 4000 ? `${message.slice(0, 3997)}...` : message,
        meta: sanitizeMeta(ev.meta),
        redacted: ev.redacted,
      });
    }
    return null;
  },
});

export const appendBatchInternal = internalMutation({
  args: {
    runId: v.id("runs"),
    events: v.array(
      v.object({
        ts: v.number(),
        level: RunEventLevel,
        message: v.string(),
        meta: v.optional(RunEventMeta),
        redacted: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { runId, events }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const safeEvents = events.slice(0, 200);
    for (const ev of safeEvents) {
      const message = ev.message.trim();
      if (!message) continue;
      await ctx.db.insert("runEvents", {
        projectId: run.projectId,
        runId,
        ts: ev.ts,
        level: ev.level,
        message: message.length > 4000 ? `${message.slice(0, 3997)}...` : message,
        meta: sanitizeMeta(ev.meta),
        redacted: ev.redacted,
      });
    }
    return null;
  },
});
