import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "./lib/auth";
import { ensureBoundedString, CONTROL_PLANE_LIMITS } from "./lib/controlPlane";
import { fail } from "./lib/errors";
import { rateLimit } from "./lib/rateLimit";
import { SecretWiringDoc } from "./lib/validators";
import { SecretWiringScope, SecretWiringStatus } from "./schema";

const SecretWiringEntry = v.object({
  secretName: v.string(),
  scope: SecretWiringScope,
  status: SecretWiringStatus,
  required: v.boolean(),
  lastVerifiedAt: v.optional(v.number()),
});

const SecretWiringUpsertArgs = {
  projectId: v.id("projects"),
  hostName: v.string(),
  entries: v.array(SecretWiringEntry),
} as const;

type SecretWiringEntryInput = {
  secretName: string;
  scope: string;
  status: string;
  required: boolean;
  lastVerifiedAt?: number;
};

function normalizeScope(value: string): "bootstrap" | "updates" | "openclaw" {
  if (value === "bootstrap" || value === "updates" || value === "openclaw") return value;
  fail("conflict", `invalid secret scope: ${value}`);
}

function normalizeStatus(value: string): "configured" | "missing" | "placeholder" | "warn" {
  if (value === "configured" || value === "missing" || value === "placeholder" || value === "warn") return value;
  fail("conflict", `invalid secret status: ${value}`);
}

async function upsertManyImpl(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  hostName: string,
  entries: SecretWiringEntryInput[],
): Promise<{ updated: number }> {
  const host = ensureBoundedString(hostName, "hostName", CONTROL_PLANE_LIMITS.hostName);
  let updated = 0;
  const existingRows = await ctx.db
    .query("secretWiring")
    .withIndex("by_project_host", (q) => q.eq("projectId", projectId).eq("hostName", host))
    .collect();
  const bySecretName = new Map<string, { _id: Id<"secretWiring"> }>(
    existingRows.map((row) => [row.secretName, { _id: row._id }]),
  );
  for (const entry of entries) {
    const secretName = ensureBoundedString(entry.secretName, "entries.secretName", CONTROL_PLANE_LIMITS.secretName);
    const existing = bySecretName.get(secretName);
    const next = {
      scope: normalizeScope(entry.scope),
      status: normalizeStatus(entry.status),
      required: entry.required,
      lastVerifiedAt: entry.lastVerifiedAt,
    };
    if (existing) {
      await ctx.db.patch(existing._id, next);
    } else {
      const inserted = await ctx.db.insert("secretWiring", {
        projectId,
        hostName: host,
        secretName,
        ...next,
      });
      bySecretName.set(secretName, { _id: inserted });
    }
    updated += 1;
  }
  return { updated };
}

export const upsertMany = mutation({
  args: SecretWiringUpsertArgs,
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, { projectId, hostName, entries }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `secretWiring.upsertMany:${access.authed.user._id}`,
      limit: 120,
      windowMs: 60_000,
    });

    return await upsertManyImpl(ctx, projectId, hostName, entries);
  },
});

export const upsertManyInternal = internalMutation({
  args: SecretWiringUpsertArgs,
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, { projectId, hostName, entries }) => {
    return await upsertManyImpl(ctx, projectId, hostName, entries);
  },
});

export const listByProjectHost = query({
  args: { projectId: v.id("projects"), hostName: v.string() },
  returns: v.array(SecretWiringDoc),
  handler: async (ctx, { projectId, hostName }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const host = ensureBoundedString(hostName, "hostName", CONTROL_PLANE_LIMITS.hostName);
    const rows = await ctx.db
      .query("secretWiring")
      .withIndex("by_project_host", (q) => q.eq("projectId", projectId).eq("hostName", host))
      .collect();
    return rows.sort((a, b) => a.secretName.localeCompare(b.secretName));
  },
});
