import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ProjectDoc } from "../shared/validators";
import { toProjectDocValue } from "../shared/returnShapes";
import { ExecutionMode, Role, WorkspaceRef } from "../schema";
import {
  requireAuthMutation,
  requireAuthQuery,
  requireProjectAccessMutation,
  requireProjectAccessQuery,
  requireAdmin,
} from "../shared/auth";
import { CONTROL_PLANE_LIMITS, ensureOptionalBoundedString } from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import { GatewayIdSchema, HostNameSchema } from "@clawlets/shared/lib/identifiers";
import { normalizeWorkspaceRef } from "../shared/workspaceRef";

const LIVE_SCHEMA_TARGET_MAX_LEN = 128;
const RUNNER_REPO_PATH_MAX_LEN = CONTROL_PLANE_LIMITS.projectConfigPath;
const DashboardProjectConfigSummary = v.object({
  configPath: v.union(v.string(), v.null()),
  configMtimeMs: v.union(v.number(), v.null()),
  gatewaysTotal: v.number(),
  gatewayIdsPreview: v.array(v.string()),
  hostsTotal: v.number(),
  hostsEnabled: v.number(),
  defaultHost: v.union(v.string(), v.null()),
  codexEnabled: v.boolean(),
  resticEnabled: v.boolean(),
  error: v.union(v.string(), v.null()),
});
const DashboardProjectSummary = v.object({
  projectId: v.id("projects"),
  name: v.string(),
  status: v.union(v.literal("creating"), v.literal("ready"), v.literal("error")),
  executionMode: ExecutionMode,
  workspaceRef: WorkspaceRef,
  localPath: v.union(v.string(), v.null()),
  runnerRepoPath: v.union(v.string(), v.null()),
  updatedAt: v.number(),
  lastSeenAt: v.union(v.number(), v.null()),
  cfg: DashboardProjectConfigSummary,
});

async function listAccessibleProjects(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"projects">[]> {
  const owned = await ctx.db
    .query("projects")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
    .collect();

  const memberships = await ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const memberProjectIds = Array.from(new Set(memberships.map((m) => m.projectId)));
  const memberProjects = (await Promise.all(memberProjectIds.map(async (projectId) => await ctx.db.get(projectId)))).filter(
    (p): p is Doc<"projects"> => p !== null,
  );

  const byId = new Map<string, Doc<"projects">>();
  for (const p of owned) byId.set(p._id, p);
  for (const p of memberProjects) byId.set(p._id, p);
  return Array.from(byId.values()).toSorted((a, b) => b.updatedAt - a.updatedAt);
}

function normalizeRepoPathSlashes(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  return normalized || "/";
}

function hasTraversalPathSegment(value: string): boolean {
  return value.split("/").some((segment) => segment === "..");
}

function normalizeRunnerRepoPath(input: unknown): string | undefined {
  const value = ensureOptionalBoundedString(
    typeof input === "string" ? input : undefined,
    "runnerRepoPath",
    RUNNER_REPO_PATH_MAX_LEN,
  );
  if (!value) return undefined;
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    fail("conflict", "runnerRepoPath contains forbidden characters");
  }
  const normalized = normalizeRepoPathSlashes(value);
  if (hasTraversalPathSegment(normalized)) {
    fail("conflict", "runnerRepoPath cannot contain '..' path segments");
  }
  return normalized;
}

export function __test_normalizeRunnerRepoPath(input: unknown): string | undefined {
  return normalizeRunnerRepoPath(input);
}

export function validateProjectCreateMode(params: {
  executionMode: "local" | "remote_runner";
  localPath: string;
  runnerRepoPath?: string;
  workspaceRefKind: "local" | "git";
}): void {
  if (params.executionMode === "local") {
    if (!params.localPath) fail("conflict", "localPath required");
    if (params.runnerRepoPath) fail("conflict", "runnerRepoPath forbidden for local execution mode");
    if (params.workspaceRefKind !== "local") fail("conflict", "workspaceRef.kind must be local for local execution");
    return;
  }
  if (params.localPath) fail("conflict", "localPath forbidden for remote_runner execution mode");
  if (!params.runnerRepoPath) fail("conflict", "runnerRepoPath required for remote_runner execution mode");
  if (params.workspaceRefKind !== "git") fail("conflict", "workspaceRef.kind must be git for remote_runner execution");
}

export function parseLiveSchemaTarget(args: { host: string; gatewayId: string }): { host: string; gatewayId: string } {
  const host = args.host.trim();
  const gatewayId = args.gatewayId.trim();
  if (!host) fail("conflict", "host required");
  if (!gatewayId) fail("conflict", "gatewayId required");
  if (host.length > LIVE_SCHEMA_TARGET_MAX_LEN) fail("conflict", "host too long");
  if (gatewayId.length > LIVE_SCHEMA_TARGET_MAX_LEN) fail("conflict", "gatewayId too long");
  const hostParsed = HostNameSchema.safeParse(host);
  if (!hostParsed.success) fail("conflict", hostParsed.error.issues[0]?.message ?? "invalid host");
  const gatewayParsed = GatewayIdSchema.safeParse(gatewayId);
  if (!gatewayParsed.success) fail("conflict", gatewayParsed.error.issues[0]?.message ?? "invalid gateway id");
  return { host, gatewayId };
}

export const list = query({
  args: {},
  returns: v.array(ProjectDoc),
  handler: async (ctx) => {
    const { user } = await requireAuthQuery(ctx);
    return (await listAccessibleProjects(ctx, user._id))
      .map(toProjectDocValue)
      .toSorted((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const dashboardOverview = query({
  args: {},
  returns: v.object({ projects: v.array(DashboardProjectSummary) }),
  handler: async (ctx) => {
    const { user } = await requireAuthQuery(ctx);
    const projects = await listAccessibleProjects(ctx, user._id);

    const summaries = await Promise.all(
      projects.map(async (project) => {
        const [projectConfigs, hosts] = await Promise.all([
          ctx.db
            .query("projectConfigs")
            .withIndex("by_project", (q) => q.eq("projectId", project._id))
            .collect(),
          ctx.db
            .query("hosts")
            .withIndex("by_project", (q) => q.eq("projectId", project._id))
            .collect(),
        ]);
        const sortedHosts = hosts.toSorted((a, b) => a.hostName.localeCompare(b.hostName));
        const fleetCfg = projectConfigs.find((row) => row.type === "fleet") ?? projectConfigs[0] ?? null;
        const configMtimeMs = projectConfigs.reduce<number | null>((acc, row) => {
          const value = typeof row.lastSyncAt === "number" ? row.lastSyncAt : null;
          if (value === null) return acc;
          if (acc === null) return value;
          return Math.max(acc, value);
        }, null);
        const firstError = projectConfigs.find((row) => typeof row.lastError === "string" && row.lastError.trim());
        const hostsEnabled = sortedHosts.filter((row) => row.desired?.enabled === true).length;
        const gatewaysTotal = sortedHosts.reduce((total, row) => {
          const count = row.desired?.gatewayCount;
          return total + (typeof count === "number" && Number.isFinite(count) ? count : 0);
        }, 0);
        return {
          projectId: project._id,
          name: project.name,
          status: project.status,
          executionMode: project.executionMode,
          workspaceRef: project.workspaceRef,
          localPath: typeof project.localPath === "string" ? project.localPath : null,
          runnerRepoPath: typeof project.runnerRepoPath === "string" ? project.runnerRepoPath : null,
          updatedAt: project.updatedAt,
          lastSeenAt: typeof project.lastSeenAt === "number" ? project.lastSeenAt : null,
          cfg: {
            configPath: fleetCfg?.path ?? null,
            configMtimeMs,
            gatewaysTotal,
            gatewayIdsPreview: [],
            hostsTotal: sortedHosts.length,
            hostsEnabled,
            defaultHost: sortedHosts[0]?.hostName ?? null,
            codexEnabled: false,
            resticEnabled: false,
            error: firstError?.lastError ?? null,
          },
        };
      }),
    );
    return { projects: summaries };
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  returns: v.object({ project: ProjectDoc, role: Role }),
  handler: async (ctx, { projectId }) => {
    const { project, role } = await requireProjectAccessQuery(ctx, projectId);
    return { project: toProjectDocValue(project), role };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    executionMode: ExecutionMode,
    workspaceRef: WorkspaceRef,
    localPath: v.optional(v.string()),
    runnerRepoPath: v.optional(v.string()),
  },
  returns: v.object({ projectId: v.id("projects") }),
  handler: async (ctx, args) => {
    const { user } = await requireAuthMutation(ctx);
    await rateLimit({ ctx, key: `projects.create:${user._id}`, limit: 10, windowMs: 60_000 });

    const now = Date.now();
    const name = args.name.trim();
    const executionMode = args.executionMode;
    const workspaceRef = normalizeWorkspaceRef(args.workspaceRef);
    const localPath = typeof args.localPath === "string" ? args.localPath.trim() : "";
    const runnerRepoPath = normalizeRunnerRepoPath(args.runnerRepoPath);
    if (!name) fail("conflict", "name required");
    validateProjectCreateMode({
      executionMode,
      localPath,
      runnerRepoPath,
      workspaceRefKind: workspaceRef.kind,
    });

    const existingByName = await ctx.db
      .query("projects")
      .withIndex("by_owner_name", (q) => q.eq("ownerUserId", user._id).eq("name", name))
      .unique();
    if (existingByName) fail("conflict", "project name already exists");

    const existingByWorkspaceRef = await ctx.db
      .query("projects")
      .withIndex("by_owner_workspaceRefKey", (q) => q.eq("ownerUserId", user._id).eq("workspaceRefKey", workspaceRef.key))
      .unique();
    if (existingByWorkspaceRef) fail("conflict", "workspaceRef already exists");

    const existingByPath = localPath
      ? await ctx.db
          .query("projects")
          .withIndex("by_owner_localPath", (q) => q.eq("ownerUserId", user._id).eq("localPath", localPath))
          .unique()
      : null;
    if (existingByPath) fail("conflict", "project path already exists");

    const projectId = await ctx.db.insert("projects", {
      ownerUserId: user._id,
      name,
      executionMode,
      workspaceRef: { kind: workspaceRef.kind, id: workspaceRef.id, relPath: workspaceRef.relPath },
      workspaceRefKey: workspaceRef.key,
      localPath: localPath || undefined,
      runnerRepoPath: runnerRepoPath || undefined,
      status: "creating",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    });

    await ctx.db.insert("projectPolicies", {
      projectId,
      retentionDays: 30,
      gitWritePolicy: "pr_only",
      createdAt: now,
      updatedAt: now,
    });

    return { projectId };
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    localPath: v.optional(v.string()),
    runnerRepoPath: v.optional(v.string()),
    workspaceRef: v.optional(WorkspaceRef),
    status: v.optional(v.union(v.literal("creating"), v.literal("ready"), v.literal("error"))),
  },
  returns: ProjectDoc,
  handler: async (ctx, args) => {
    const { projectId, ...patch } = args;
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    const project = access.project;

    const now = Date.now();
    const next: Record<string, unknown> = {
      updatedAt: now,
    };
    if (project.executionMode === "remote_runner") next["localPath"] = undefined;
    if (project.executionMode === "local") next["runnerRepoPath"] = undefined;
    if (typeof patch.name === "string") {
      const name = patch.name.trim();
      if (!name) fail("conflict", "name required");
      if (name !== project.name) {
        const existing = await ctx.db
          .query("projects")
          .withIndex("by_owner_name", (q) => q.eq("ownerUserId", project.ownerUserId).eq("name", name))
          .take(2);
        if (existing.some((p) => p._id !== projectId)) {
          fail("conflict", "project name already exists");
        }
      }
      next["name"] = name;
    }
    if (typeof patch.status === "string") next["status"] = patch.status;

    if (patch.workspaceRef) {
      const workspaceRef = normalizeWorkspaceRef(patch.workspaceRef);
      if (project.executionMode === "local" && workspaceRef.kind !== "local") {
        fail("conflict", "workspaceRef.kind must be local for local execution");
      }
      if (project.executionMode === "remote_runner" && workspaceRef.kind !== "git") {
        fail("conflict", "workspaceRef.kind must be git for remote_runner execution");
      }
      if (workspaceRef.key !== project.workspaceRefKey) {
        const existing = await ctx.db
          .query("projects")
          .withIndex("by_owner_workspaceRefKey", (q) =>
            q.eq("ownerUserId", project.ownerUserId).eq("workspaceRefKey", workspaceRef.key),
          )
          .take(2);
        if (existing.some((p) => p._id !== projectId)) {
          fail("conflict", "workspaceRef already exists");
        }
      }
      next["workspaceRef"] = { kind: workspaceRef.kind, id: workspaceRef.id, relPath: workspaceRef.relPath };
      next["workspaceRefKey"] = workspaceRef.key;
    }

    if (typeof patch.localPath === "string") {
      const localPath = patch.localPath.trim();
      if (project.executionMode !== "local") fail("conflict", "localPath forbidden for remote_runner execution mode");
      if (!localPath) fail("conflict", "localPath required");
      if (localPath !== (project.localPath || "").trim()) {
        const existing = await ctx.db
          .query("projects")
          .withIndex("by_owner_localPath", (q) =>
            q.eq("ownerUserId", project.ownerUserId).eq("localPath", localPath),
          )
          .take(2);
        if (existing.some((p) => p._id !== projectId)) {
          fail("conflict", "project path already exists");
        }
      }
      next["localPath"] = localPath;
    }

    if (typeof patch.runnerRepoPath === "string") {
      if (project.executionMode !== "remote_runner") {
        fail("conflict", "runnerRepoPath forbidden for local execution mode");
      }
      const runnerRepoPath = normalizeRunnerRepoPath(patch.runnerRepoPath);
      if (!runnerRepoPath) fail("conflict", "runnerRepoPath required for remote_runner execution mode");
      next["runnerRepoPath"] = runnerRepoPath;
    }

    await ctx.db.patch(projectId, next);
    const updated = await ctx.db.get(projectId);
    if (!updated) fail("not_found", "project not found");
    return toProjectDocValue(updated);
  },
});

export const guardLiveSchemaFetch = mutation({
  args: {
    projectId: v.id("projects"),
    host: v.string(),
    gatewayId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);

    const { host, gatewayId } = parseLiveSchemaTarget(args);

    await rateLimit({ ctx, key: `schemaLive.fetch:${args.projectId}`, limit: 20, windowMs: 60_000 });
    await ctx.db.insert("auditLogs", {
      ts: Date.now(),
      userId: access.authed.user._id,
      projectId: args.projectId,
      action: "openclaw.schema.live.fetch",
      target: { host, gatewayId },
    });
    return null;
  },
});
