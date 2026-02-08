import { fail } from "./errors";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { authComponent } from "../auth";

export type Authed = {
  user: Doc<"users">;
};

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function getUserByAuthUserId(ctx: QueryCtx, authUserId: string): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
    .unique();
}

async function ensureUserByAuthUser(ctx: MutationCtx, authUser: { _id: string; name?: string | null; email?: string | null; image?: string | null }): Promise<Authed> {
  const now = Date.now();
  const authUserId = String(authUser._id);
  const adminUsers = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .take(2);
  const hasAdmin = adminUsers.length > 0;
  const existing = await ctx.db
    .query("users")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
    .unique();

  if (existing) {
    const nextRole = !hasAdmin ? "admin" : existing.role;
    await ctx.db.patch(existing._id, {
      name: typeof authUser.name === "string" ? authUser.name : undefined,
      email: typeof authUser.email === "string" ? authUser.email : undefined,
      pictureUrl: typeof authUser.image === "string" ? authUser.image : undefined,
      role: nextRole,
      updatedAt: now,
    });
    const patched = await ctx.db.get(existing._id);
    if (!patched) fail("not_found", "user disappeared");
    return { user: patched };
  }

  const isFirstUser = (await ctx.db.query("users").take(1)).length === 0;
  const shouldPromote = isFirstUser || !hasAdmin;
  const userId = await ctx.db.insert("users", {
    authUserId,
    name: typeof authUser.name === "string" ? authUser.name : undefined,
    email: typeof authUser.email === "string" ? authUser.email : undefined,
    pictureUrl: typeof authUser.image === "string" ? authUser.image : undefined,
    role: shouldPromote ? "admin" : "viewer",
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get(userId);
  if (!user) fail("not_found", "failed to create user");
  return { user };
}

export async function requireAuthQuery(ctx: QueryCtx): Promise<Authed> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) fail("unauthorized", "sign-in required");
  const obj = asPlainObject(authUser);
  const authUserId = asOptionalString(obj?.["_id"]);
  if (!authUserId) fail("unauthorized", "invalid auth user");
  const user = await getUserByAuthUserId(ctx, authUserId);
  if (!user) fail("unauthorized", "user missing (run users.ensureCurrent)");
  return { user };
}

export async function requireAuthMutation(ctx: MutationCtx): Promise<Authed> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) fail("unauthorized", "sign-in required");
  const obj = asPlainObject(authUser);
  const authUserId = asOptionalString(obj?.["_id"]);
  if (!authUserId) fail("unauthorized", "invalid auth user");
  const picked = {
    _id: authUserId,
    name: typeof obj?.["name"] === "string" ? obj["name"] : null,
    email: typeof obj?.["email"] === "string" ? obj["email"] : null,
    image: typeof obj?.["image"] === "string" ? obj["image"] : null,
  };
  return await ensureUserByAuthUser(ctx, picked);
}

async function requireProjectAccessCommon(params: {
  ctx: QueryCtx | MutationCtx;
  authed: Authed;
  projectId: Id<"projects">;
}): Promise<{ authed: Authed; project: Doc<"projects">; role: "admin" | "viewer" }> {
  const { ctx, authed, projectId } = params;
  const project = await ctx.db.get(projectId);
  if (!project) fail("not_found", "project not found");
  if (project.ownerUserId === authed.user._id) return { authed, project, role: "admin" };

  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (q) => q.eq("projectId", projectId).eq("userId", authed.user._id))
    .unique();
  if (!membership) fail("forbidden", "project access denied");
  return { authed, project, role: membership.role };
}

export async function requireProjectAccessQuery(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<{ authed: Authed; project: Doc<"projects">; role: "admin" | "viewer" }> {
  const authed = await requireAuthQuery(ctx);
  return await requireProjectAccessCommon({ ctx, authed, projectId });
}

export async function requireProjectAccessMutation(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<{ authed: Authed; project: Doc<"projects">; role: "admin" | "viewer" }> {
  const authed = await requireAuthMutation(ctx);
  return await requireProjectAccessCommon({ ctx, authed, projectId });
}

export function requireAdmin(role: "admin" | "viewer"): void {
  if (role !== "admin") fail("forbidden", "admin required");
}
