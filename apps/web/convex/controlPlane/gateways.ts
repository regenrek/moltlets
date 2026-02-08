import { HOST_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { ensureBoundedString, sanitizeDesiredGatewaySummary, CONTROL_PLANE_LIMITS } from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import { GatewayDoc } from "../shared/validators";
import { HostStatus } from "../schema";

const DesiredGatewaySummaryPatch = v.object({
  enabled: v.optional(v.boolean()),
  channelCount: v.optional(v.number()),
  personaCount: v.optional(v.number()),
  provider: v.optional(v.string()),
  channels: v.optional(v.array(v.string())),
  personaIds: v.optional(v.array(v.string())),
  port: v.optional(v.number()),
});

const GatewayPatch = v.object({
  lastSeenAt: v.optional(v.number()),
  lastStatus: v.optional(HostStatus),
  desired: v.optional(DesiredGatewaySummaryPatch),
});

const GatewayUpsertArgs = {
  projectId: v.id("projects"),
  hostName: v.string(),
  gatewayId: v.string(),
  patch: GatewayPatch,
} as const;

type GatewayPatchInput = {
  lastSeenAt?: number;
  lastStatus?: string;
  desired?: {
    enabled?: boolean;
    channelCount?: number;
    personaCount?: number;
    provider?: string;
    channels?: string[];
    personaIds?: string[];
    port?: number;
  };
};

function normalizeHostStatus(value: string | undefined): (typeof HOST_STATUSES)[number] | undefined {
  if (!value) return undefined;
  if ((HOST_STATUSES as readonly string[]).includes(value)) {
    return value as (typeof HOST_STATUSES)[number];
  }
  fail("conflict", `invalid host status: ${value}`);
}

export function sanitizeGatewayPatchInput(patch: GatewayPatchInput): {
  lastSeenAt?: number;
  lastStatus?: (typeof HOST_STATUSES)[number];
  desired?: {
    enabled?: boolean;
    channelCount?: number;
    personaCount?: number;
    provider?: string;
    channels?: string[];
    personaIds?: string[];
    port?: number;
  };
} {
  return {
    lastSeenAt:
      typeof patch.lastSeenAt === "number" && Number.isFinite(patch.lastSeenAt)
        ? Math.trunc(patch.lastSeenAt)
        : undefined,
    lastStatus: normalizeHostStatus(patch.lastStatus),
    desired: sanitizeDesiredGatewaySummary(patch.desired, "gateways.patch.desired"),
  };
}

async function upsertGatewayImpl(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  hostName: string;
  gatewayId: string;
  patch: GatewayPatchInput;
}): Promise<{ gatewayDocId: Id<"gateways"> }> {
  const host = ensureBoundedString(params.hostName, "hostName", CONTROL_PLANE_LIMITS.hostName);
  const gateway = ensureBoundedString(params.gatewayId, "gatewayId", CONTROL_PLANE_LIMITS.gatewayId);
  const next = sanitizeGatewayPatchInput(params.patch);
  const existing = await params.ctx.db
    .query("gateways")
    .withIndex("by_project_host_gateway", (q) =>
      q.eq("projectId", params.projectId).eq("hostName", host).eq("gatewayId", gateway),
    )
    .unique();
  if (existing) {
    await params.ctx.db.patch(existing._id, {
      ...next,
    });
    return { gatewayDocId: existing._id };
  }
  const gatewayDocId = await params.ctx.db.insert("gateways", {
    projectId: params.projectId,
    hostName: host,
    gatewayId: gateway,
    ...next,
  });
  return { gatewayDocId };
}

export const upsert = mutation({
  args: GatewayUpsertArgs,
  returns: v.object({ gatewayDocId: v.id("gateways") }),
  handler: async (ctx, { projectId, hostName, gatewayId, patch }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `gateways.upsert:${access.authed.user._id}`, limit: 120, windowMs: 60_000 });

    return await upsertGatewayImpl({ ctx, projectId, hostName, gatewayId, patch });
  },
});

export const upsertInternal = internalMutation({
  args: GatewayUpsertArgs,
  returns: v.object({ gatewayDocId: v.id("gateways") }),
  handler: async (ctx, { projectId, hostName, gatewayId, patch }) => {
    return await upsertGatewayImpl({ ctx, projectId, hostName, gatewayId, patch });
  },
});

export const listByProjectHost = query({
  args: { projectId: v.id("projects"), hostName: v.string() },
  returns: v.array(GatewayDoc),
  handler: async (ctx, { projectId, hostName }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const host = ensureBoundedString(hostName, "hostName", CONTROL_PLANE_LIMITS.hostName);
    const rows = await ctx.db
      .query("gateways")
      .withIndex("by_project_host", (q) => q.eq("projectId", projectId).eq("hostName", host))
      .collect();
    return rows.toSorted((a, b) => a.gatewayId.localeCompare(b.gatewayId));
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(GatewayDoc),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("gateways")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.toSorted((a, b) => {
      const hostCmp = a.hostName.localeCompare(b.hostName);
      if (hostCmp !== 0) return hostCmp;
      return a.gatewayId.localeCompare(b.gatewayId);
    });
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects"), hostName: v.string(), gatewayId: v.string() },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, { projectId, hostName, gatewayId }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `gateways.remove:${access.authed.user._id}`, limit: 120, windowMs: 60_000 });

    const host = ensureBoundedString(hostName, "hostName", CONTROL_PLANE_LIMITS.hostName);
    const gateway = ensureBoundedString(gatewayId, "gatewayId", CONTROL_PLANE_LIMITS.gatewayId);
    const existing = await ctx.db
      .query("gateways")
      .withIndex("by_project_host_gateway", (q) =>
        q.eq("projectId", projectId).eq("hostName", host).eq("gatewayId", gateway),
      )
      .unique();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});
