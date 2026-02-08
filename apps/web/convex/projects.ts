import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ProjectDoc } from "./lib/validators";
import { ExecutionMode, Role, WorkspaceRef } from "./schema";
import {
  requireAuthMutation,
  requireAuthQuery,
  requireProjectAccessMutation,
  requireProjectAccessQuery,
  requireAdmin,
} from "./lib/auth";
import { fail } from "./lib/errors";
import { rateLimit } from "./lib/rateLimit";
import { GatewayIdSchema, HostNameSchema } from "@clawlets/shared/lib/identifiers";
import { normalizeWorkspaceRef } from "./lib/workspaceRef";

const LIVE_SCHEMA_TARGET_MAX_LEN = 128;

function parseLiveSchemaTarget(args: { host: string; gatewayId: string }): { host: string; gatewayId: string } {
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

export function __test_parseLiveSchemaTarget(args: {
  host: string;
  gatewayId: string;
}): { host: string; gatewayId: string } {
  return parseLiveSchemaTarget(args);
}

export const list = query({
  args: {},
  returns: v.array(ProjectDoc),
  handler: async (ctx) => {
    const { user } = await requireAuthQuery(ctx);

    const owned = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .collect();

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const memberProjectIds = Array.from(new Set(memberships.map((m) => m.projectId)));
    const memberProjects = (await Promise.all(memberProjectIds.map(async (projectId) => await ctx.db.get(projectId)))).filter(
      (p): p is Doc<"projects"> => p !== null,
    );

    const byId = new Map<string, Doc<"projects">>();
    for (const p of owned) byId.set(p._id, p);
    for (const p of memberProjects) byId.set(p._id, p);
    return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  returns: v.object({ project: ProjectDoc, role: Role }),
  handler: async (ctx, { projectId }) => {
    const { project, role } = await requireProjectAccessQuery(ctx, projectId);
    return { project, role };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    executionMode: ExecutionMode,
    workspaceRef: WorkspaceRef,
    localPath: v.optional(v.string()),
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
    if (!name) fail("conflict", "name required");
    if (executionMode === "local") {
      if (!localPath) fail("conflict", "localPath required");
      if (workspaceRef.kind !== "local") fail("conflict", "workspaceRef.kind must be local for local execution");
    } else {
      if (localPath) fail("conflict", "localPath forbidden for remote_runner execution mode");
      if (workspaceRef.kind !== "git") fail("conflict", "workspaceRef.kind must be git for remote_runner execution");
    }

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
    workspaceRef: v.optional(WorkspaceRef),
    status: v.optional(v.union(v.literal("creating"), v.literal("ready"), v.literal("error"))),
  },
  returns: ProjectDoc,
  handler: async (ctx, args) => {
    const { projectId, ...patch } = args;
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);

    const now = Date.now();
    const next: Record<string, unknown> = { updatedAt: now };
      if (typeof patch.name === "string") {
        const name = patch.name.trim();
        if (!name) fail("conflict", "name required");
        if (name !== access.project.name) {
          const existing = await ctx.db
            .query("projects")
            .withIndex("by_owner_name", (q) => q.eq("ownerUserId", access.project.ownerUserId).eq("name", name))
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
      if (access.project.executionMode === "local" && workspaceRef.kind !== "local") {
        fail("conflict", "workspaceRef.kind must be local for local execution");
      }
      if (access.project.executionMode === "remote_runner" && workspaceRef.kind !== "git") {
        fail("conflict", "workspaceRef.kind must be git for remote_runner execution");
      }
      if (workspaceRef.key !== access.project.workspaceRefKey) {
        const existing = await ctx.db
          .query("projects")
          .withIndex("by_owner_workspaceRefKey", (q) =>
            q.eq("ownerUserId", access.project.ownerUserId).eq("workspaceRefKey", workspaceRef.key),
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
      if (access.project.executionMode !== "local") fail("conflict", "localPath forbidden for remote_runner execution mode");
      if (!localPath) fail("conflict", "localPath required");
      if (localPath !== (access.project.localPath || "").trim()) {
        const existing = await ctx.db
          .query("projects")
          .withIndex("by_owner_localPath", (q) =>
            q.eq("ownerUserId", access.project.ownerUserId).eq("localPath", localPath),
          )
          .take(2);
        if (existing.some((p) => p._id !== projectId)) {
          fail("conflict", "project path already exists");
        }
      }
      next["localPath"] = localPath;
    }

    await ctx.db.patch(projectId, next);
    const updated = await ctx.db.get(projectId);
    if (!updated) fail("not_found", "project not found");
    return updated;
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

export function __test_normalizeWorkspaceRef(value: {
  kind: "local" | "git";
  id: string;
  relPath?: string;
}): { kind: "local" | "git"; id: string; relPath?: string; key: string } {
  return normalizeWorkspaceRef(value);
}
