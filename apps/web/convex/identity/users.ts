import { v } from "convex/values";

import { query, mutation } from "../_generated/server";
import { authComponent } from "../auth";
import { requireAuthMutation } from "../shared/auth";
import { isAuthDisabled } from "../shared/env";
import { UserDoc } from "../shared/validators";

const AuthUserPreview = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  image: v.optional(v.string()),
});

const ViewerDoc = v.object({
  user: UserDoc,
  auth: AuthUserPreview,
});

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export const getCurrent = query({
  args: {},
  returns: v.union(v.null(), ViewerDoc),
  handler: async (ctx) => {
    if (isAuthDisabled()) {
      const adminUser = (await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "admin"))
        .take(1))[0];
      const user = adminUser ?? (await ctx.db.query("users").take(1))[0] ?? null;
      if (!user) return null;
      return {
        user,
        auth: {
          id: user.authUserId,
          ...(user.name ? { name: user.name } : {}),
          ...(user.email ? { email: user.email } : {}),
          ...(user.pictureUrl ? { image: user.pictureUrl } : {}),
        },
      };
    }

    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const obj = asPlainObject(authUser);
    const authUserId = asOptionalString(obj?.["_id"]);
    if (!authUserId) return null;

    // Keep reads non-throwing so UI can tolerate the first render before
    // `users.ensureCurrent` has created the app user doc.
    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
      .unique();
    if (!user) return null;

    const id = authUserId;
    const name = asOptionalString(obj?.["name"]);
    const email = asOptionalString(obj?.["email"]);
    const image = asOptionalString(obj?.["image"]);

    return {
      user,
      auth: {
        id,
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(image ? { image } : {}),
      },
    };
  },
});

export const ensureCurrent = mutation({
  args: {},
  returns: UserDoc,
  handler: async (ctx) => {
    const { user } = await requireAuthMutation(ctx);
    return user;
  },
});
