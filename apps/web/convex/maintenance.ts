import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { normalizeWorkspaceRef } from "./lib/workspaceRef";

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

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseExecutionMode(value: unknown): "local" | "remote_runner" | null {
  if (value === "local") return "local";
  if (value === "remote_runner") return "remote_runner";
  return null;
}

function parseWorkspaceRef(value: unknown): { kind: "local" | "git"; id: string; relPath?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const kind = v["kind"];
  const id = asNonEmptyString(v["id"]);
  const relPath = asNonEmptyString(v["relPath"]) || undefined;
  if (kind !== "local" && kind !== "git") return null;
  if (!id) return null;
  if (id.length > 128) return null;
  if (relPath && relPath.length > 256) return null;
  return { kind, id, relPath };
}

async function buildLocalWorkspaceRefId(localPath: string): Promise<string> {
  const normalized = localPath.trim().toLowerCase();
  const digest = await sha256Hex(normalized);
  return `sha256:${digest}`;
}

export const backfillProjectsMetadata = internalMutation({
  args: {
    confirm: v.string(),
    dryRun: v.optional(v.boolean()),
    maxProjects: v.optional(v.number()),
    cursor: v.optional(v.string()),
    scannedSoFar: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    patched: v.number(),
    policiesInserted: v.number(),
    collisionsResolved: v.number(),
    dryRun: v.boolean(),
    continued: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (args.confirm !== "BACKFILL_PROJECTS_METADATA_V1") {
      throw new Error("Refusing to backfill. Pass confirm=BACKFILL_PROJECTS_METADATA_V1.");
    }
    requireMaintenanceEnabled("backfillProjectsMetadata");
    const dryRun = args.dryRun === true;
    const maxProjects = Math.max(1, Math.min(10_000, Math.trunc(args.maxProjects ?? 10_000)));
    const now = Date.now();

    let collisionsResolved = 0;
    let scanned = 0;
    let patched = 0;
    let policiesInserted = 0;
    let cursor: string | null = typeof args.cursor === "string" ? args.cursor : null;
    const scannedSoFar = Math.max(0, Math.trunc(args.scannedSoFar ?? 0));
    const remainingGlobal = Math.max(0, maxProjects - scannedSoFar);
    const batchLimit = Math.min(250, remainingGlobal);

    for (let i = 0; i < batchLimit; i += 1) {
      const page = await ctx.db
        .query("projects")
        .order("asc")
        .paginate({ cursor, numItems: 1 });
      const project = page.page[0];
      cursor = page.isDone ? null : page.continueCursor;
      if (!project) break;

      scanned += 1;
      const raw = project as unknown as Record<string, unknown>;
      const localPath = asNonEmptyString(raw["localPath"]);

      const executionModeExisting = parseExecutionMode(raw["executionMode"]);
      let executionMode: "local" | "remote_runner" = executionModeExisting ?? (localPath ? "local" : "remote_runner");
      if (executionMode === "local" && !localPath) executionMode = "remote_runner";

      const workspaceRefExisting = parseWorkspaceRef(raw["workspaceRef"]);
      const workspaceRefBase =
        !workspaceRefExisting ||
          (executionMode === "local" && workspaceRefExisting.kind !== "local") ||
          (executionMode === "remote_runner" && workspaceRefExisting.kind !== "git")
          ? (executionMode === "local"
              ? { kind: "local" as const, id: await buildLocalWorkspaceRefId(localPath) }
              : { kind: "git" as const, id: `legacy:${String(project._id)}` })
          : workspaceRefExisting;

      let normalized = normalizeWorkspaceRef(workspaceRefBase);
      let workspaceRef = { kind: normalized.kind, id: normalized.id, relPath: normalized.relPath };
      let workspaceRefKey = normalized.key;

      const workspaceRefKeyExisting = asNonEmptyString(raw["workspaceRefKey"]);
      const workspaceRefMatches =
        workspaceRefExisting &&
        workspaceRefExisting.kind === workspaceRef.kind &&
        asNonEmptyString(workspaceRefExisting.id) === workspaceRef.id &&
        (asNonEmptyString(workspaceRefExisting.relPath) || undefined) === workspaceRef.relPath;

      const needsPatch =
        executionModeExisting !== executionMode ||
        !workspaceRefMatches ||
        workspaceRefKeyExisting !== workspaceRefKey;

      if (needsPatch) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const conflict = await ctx.db
            .query("projects")
            .withIndex("by_owner_workspaceRefKey", (q) =>
              q.eq("ownerUserId", project.ownerUserId).eq("workspaceRefKey", workspaceRefKey),
            )
            .take(2);
          const hasOther = conflict.some((p) => p._id !== project._id);
          if (!hasOther) break;

          const hash = await sha256Hex(`${String(project._id)}:${attempt}`);
          const suffix = `:${hash.slice(0, 10)}`;
          const maxBase = Math.max(1, 128 - suffix.length);
          const nextId = `${workspaceRef.id.slice(0, maxBase)}${suffix}`;
          normalized = normalizeWorkspaceRef({ ...workspaceRef, id: nextId });
          workspaceRef = { kind: normalized.kind, id: normalized.id, relPath: normalized.relPath };
          workspaceRefKey = normalized.key;
          collisionsResolved += 1;
        }

        patched += 1;
        if (!dryRun) {
          const patch: Record<string, unknown> = {
            executionMode,
            workspaceRef,
            workspaceRefKey,
            updatedAt: now,
          };
          if (executionMode === "remote_runner") {
            patch["localPath"] = undefined;
          }
          await ctx.db.patch(project._id, patch);
        }
      }

      const existingPolicy = await ctx.db
        .query("projectPolicies")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .unique();
      if (!existingPolicy) {
        policiesInserted += 1;
        if (!dryRun) {
          await ctx.db.insert("projectPolicies", {
            projectId: project._id,
            retentionDays: 30,
            gitWritePolicy: "pr_only",
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    const continued = cursor !== null && scannedSoFar + scanned < maxProjects;
    if (continued && !dryRun) {
      await ctx.scheduler.runAfter(250, internal.maintenance.backfillProjectsMetadata, {
        confirm: args.confirm,
        dryRun,
        maxProjects,
        cursor: cursor ?? undefined,
        scannedSoFar: scannedSoFar + scanned,
      });
    }

    return {
      scanned,
      patched,
      policiesInserted,
      collisionsResolved,
      dryRun,
      continued,
    };
  },
});
