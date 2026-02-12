import { v } from "convex/values";

import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import {
  ensureBoundedString,
  randomToken,
  sha256Hex,
  CONTROL_PLANE_LIMITS,
} from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";

const RunnerTokenListItem = v.object({
  tokenId: v.id("runnerTokens"),
  runnerId: v.id("runners"),
  createdAt: v.number(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
});

const RUNNER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashToken(token: string): Promise<string> {
  return await sha256Hex(token);
}

async function upsertRunner(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runnerName: string;
}): Promise<Id<"runners">> {
  const existing = await params.ctx.db
    .query("runners")
    .withIndex("by_project_runner", (q) =>
      q.eq("projectId", params.projectId).eq("runnerName", params.runnerName),
    )
    .unique();
  if (existing) return existing._id;
  return await params.ctx.db.insert("runners", {
    projectId: params.projectId,
    runnerName: params.runnerName,
    lastSeenAt: Date.now(),
    lastStatus: "offline",
  });
}

export const create = mutation({
  args: { projectId: v.id("projects"), runnerName: v.string() },
  returns: v.object({
    tokenId: v.id("runnerTokens"),
    runnerId: v.id("runners"),
    token: v.string(),
  }),
  handler: async (ctx, { projectId, runnerName }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `runnerTokens.create:${access.authed.user._id}`,
      limit: 20,
      windowMs: 60_000,
    });

    const name = ensureBoundedString(runnerName, "runnerName", CONTROL_PLANE_LIMITS.runnerName);
    const runnerId = await upsertRunner({ ctx, projectId, runnerName: name });

    const token = randomToken();
    const tokenHash = await hashToken(token);
    const now = Date.now();
    const tokenId = await ctx.db.insert("runnerTokens", {
      projectId,
      runnerId,
      tokenHash,
      createdByUserId: access.authed.user._id,
      createdAt: now,
      expiresAt: now + RUNNER_TOKEN_TTL_MS,
    });

    return { tokenId, runnerId, token };
  },
});

export const revoke = mutation({
  args: { tokenId: v.id("runnerTokens") },
  returns: v.null(),
  handler: async (ctx, { tokenId }) => {
    const tokenRow = await ctx.db.get(tokenId);
    if (!tokenRow) fail("not_found", "runner token not found");
    const access = await requireProjectAccessMutation(ctx, tokenRow.projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `runnerTokens.revoke:${access.authed.user._id}`,
      limit: 30,
      windowMs: 60_000,
    });
    await ctx.db.patch(tokenId, { revokedAt: Date.now() });
    return null;
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(RunnerTokenListItem),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("runnerTokens")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        tokenId: row._id,
        runnerId: row.runnerId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt,
      }));
  },
});

const RunnerTokenAuthDoc = v.object({
  tokenId: v.id("runnerTokens"),
  projectId: v.id("projects"),
  runnerId: v.id("runners"),
  runnerName: v.string(),
  runnerLastStatus: v.union(v.literal("online"), v.literal("offline")),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
});

export const resolveAuthContextInternal = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(RunnerTokenAuthDoc, v.null()),
  handler: async (ctx, { tokenHash }) => {
    const tokenRow = await ctx.db
      .query("runnerTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!tokenRow) return null;
    const runner = await ctx.db.get(tokenRow.runnerId);
    if (!runner) return null;
    const runnerLastStatus: "online" | "offline" = runner.lastStatus === "offline" ? "offline" : "online";
    return {
      tokenId: tokenRow._id,
      projectId: tokenRow.projectId,
      runnerId: tokenRow.runnerId,
      runnerName: runner.runnerName,
      runnerLastStatus,
      expiresAt: tokenRow.expiresAt,
      revokedAt: tokenRow.revokedAt,
      lastUsedAt: tokenRow.lastUsedAt,
    };
  },
});

export const touchLastUsedIfStaleInternal = internalMutation({
  args: { tokenId: v.id("runnerTokens"), now: v.number(), minIntervalMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { tokenId, now, minIntervalMs }) => {
    const row = await ctx.db.get(tokenId);
    if (!row) return null;
    const minTouchIntervalMs = Math.max(0, Math.trunc(minIntervalMs));
    if (typeof row.lastUsedAt === "number" && now - row.lastUsedAt < minTouchIntervalMs) {
      return null;
    }
    await ctx.db.patch(tokenId, { lastUsedAt: now });
    return null;
  },
});
