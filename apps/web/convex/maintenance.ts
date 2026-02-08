import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const WIPE_TABLES = [
  "runEvents",
  "runs",
  "providers",
  "projectConfigs",
  "projectMembers",
  "projectPolicies",
  "projectDeletionTokens",
  "projectDeletionJobs",
  "retentionSweeps",
  "auditLogs",
  "rateLimits",
  "projects",
] as const;

type WipeTable = (typeof WIPE_TABLES)[number];

const MAINTENANCE_ENV_FLAG = "CLAWLETS_MAINTENANCE_ENABLED";
const WIPE_BATCH_SIZE = 200;
const PURGE_DEFAULT_MAX_DELETES = 5_000;
const PURGE_CONTINUE_DELAY_MS = 250;

function requireMaintenanceEnabled(op: string): void {
  const enabled = String(process.env[MAINTENANCE_ENV_FLAG] || "").trim() === "1";
  if (!enabled) {
    throw new Error(`Maintenance op disabled (${op}). Set ${MAINTENANCE_ENV_FLAG}=1 in Convex env to proceed.`);
  }
}

async function deleteTableBatch(
  ctx: MutationCtx,
  table: WipeTable,
  limit: number,
  dryRun: boolean,
): Promise<{ deleted: number; done: boolean }> {
  const docs = await ctx.db.query(table).take(Math.max(1, Math.min(WIPE_BATCH_SIZE, Math.trunc(limit))));
  if (!dryRun) {
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }
  }
  return { deleted: docs.length, done: docs.length < WIPE_BATCH_SIZE };
}

export const purgeProjects = internalMutation({
  args: {
    confirm: v.string(),
    tableIdx: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.confirm !== "DELETE_PROJECTS") {
      throw new Error("Refusing to purge. Pass confirm=DELETE_PROJECTS.");
    }

    requireMaintenanceEnabled("purgeProjects");

    const dryRun = args.dryRun === true;
    const maxDeletes = Math.max(1, Math.min(100_000, Math.trunc(args.maxDeletes ?? PURGE_DEFAULT_MAX_DELETES)));
    let tableIdx = Math.max(0, Math.min(WIPE_TABLES.length, Math.trunc(args.tableIdx ?? 0)));

    let deleted = 0;
    let lastTable: WipeTable | null = null;

    while (tableIdx < WIPE_TABLES.length && deleted < maxDeletes) {
      const table = WIPE_TABLES[tableIdx]!;
      lastTable = table;

      const batch = await deleteTableBatch(ctx, table, maxDeletes - deleted, dryRun);
      deleted += batch.deleted;
      if (batch.done) tableIdx += 1;
    }

    const continued = !dryRun && tableIdx < WIPE_TABLES.length;
    if (continued) {
      await ctx.scheduler.runAfter(PURGE_CONTINUE_DELAY_MS, internal.maintenance.purgeProjects, {
        confirm: args.confirm,
        tableIdx,
        maxDeletes,
        dryRun,
      });
    }

    return {
      ok: true,
      dryRun,
      deleted,
      continued,
      nextTableIdx: continued ? tableIdx : null,
      lastTable,
      remainingTables: Math.max(0, WIPE_TABLES.length - tableIdx),
    };
  },
});
