import { HOST_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";
import { RUN_STATUSES } from "@clawlets/core/lib/runtime/run-constants";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import {
  ensureBoundedString,
  ensureOptionalBoundedString,
  sanitizeDesiredHostSummary,
  CONTROL_PLANE_LIMITS,
} from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import { HostDoc } from "../shared/validators";
import { HostStatus, RunStatus } from "../schema";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

const DesiredHostSummaryPatch = v.object({
  enabled: v.optional(v.boolean()),
  provider: v.optional(v.string()),
  region: v.optional(v.string()),
  gatewayCount: v.optional(v.number()),
  gatewayArchitecture: v.optional(v.string()),
  updateRing: v.optional(v.string()),
  theme: v.optional(v.string()),
  sshExposureMode: v.optional(v.string()),
  targetHost: v.optional(v.string()),
  tailnetMode: v.optional(v.string()),
  selfUpdateEnabled: v.optional(v.boolean()),
  selfUpdateChannel: v.optional(v.string()),
  selfUpdateBaseUrlCount: v.optional(v.number()),
  selfUpdatePublicKeyCount: v.optional(v.number()),
  selfUpdateAllowUnsigned: v.optional(v.boolean()),
});

const HostPatch = v.object({
  provider: v.optional(v.string()),
  region: v.optional(v.string()),
  lastSeenAt: v.optional(v.number()),
  lastStatus: v.optional(HostStatus),
  lastRunId: v.optional(v.id("runs")),
  lastRunStatus: v.optional(RunStatus),
  desired: v.optional(DesiredHostSummaryPatch),
});

const HostUpsertArgs = { projectId: v.id("projects"), hostName: v.string(), patch: HostPatch } as const;

type HostPatchInput = {
  provider?: string;
  region?: string;
  lastSeenAt?: number;
  lastStatus?: string;
  lastRunId?: Id<"runs">;
  lastRunStatus?: string;
  desired?: {
    enabled?: boolean;
    provider?: string;
    region?: string;
    gatewayCount?: number;
    gatewayArchitecture?: string;
    updateRing?: string;
    theme?: string;
    sshExposureMode?: string;
    targetHost?: string;
    tailnetMode?: string;
    selfUpdateEnabled?: boolean;
    selfUpdateChannel?: string;
    selfUpdateBaseUrlCount?: number;
    selfUpdatePublicKeyCount?: number;
    selfUpdateAllowUnsigned?: boolean;
  };
};

function normalizeHostStatus(value: string | undefined): (typeof HOST_STATUSES)[number] | undefined {
  if (!value) return undefined;
  if ((HOST_STATUSES as readonly string[]).includes(value)) {
    return value as (typeof HOST_STATUSES)[number];
  }
  fail("conflict", `invalid host status: ${value}`);
}

function normalizeRunStatus(value: string | undefined): (typeof RUN_STATUSES)[number] | undefined {
  if (!value) return undefined;
  if ((RUN_STATUSES as readonly string[]).includes(value)) {
    return value as (typeof RUN_STATUSES)[number];
  }
  fail("conflict", `invalid run status: ${value}`);
}

export function sanitizeHostPatchInput(patch: HostPatchInput): {
  provider?: string;
  region?: string;
  lastSeenAt?: number;
  lastStatus?: (typeof HOST_STATUSES)[number];
  lastRunId?: Id<"runs">;
  lastRunStatus?: (typeof RUN_STATUSES)[number];
  desired?: {
    enabled?: boolean;
    provider?: string;
    region?: string;
    gatewayCount?: number;
    gatewayArchitecture?: string;
    updateRing?: string;
    theme?: string;
    sshExposureMode?: string;
    targetHost?: string;
    tailnetMode?: string;
    selfUpdateEnabled?: boolean;
    selfUpdateChannel?: string;
    selfUpdateBaseUrlCount?: number;
    selfUpdatePublicKeyCount?: number;
    selfUpdateAllowUnsigned?: boolean;
  };
} {
  return {
    provider: ensureOptionalBoundedString(patch.provider, "patch.provider", CONTROL_PLANE_LIMITS.hostName),
    region: ensureOptionalBoundedString(patch.region, "patch.region", CONTROL_PLANE_LIMITS.hostName),
    lastSeenAt:
      typeof patch.lastSeenAt === "number" && Number.isFinite(patch.lastSeenAt)
        ? Math.trunc(patch.lastSeenAt)
        : undefined,
    lastStatus: normalizeHostStatus(patch.lastStatus),
    lastRunId: patch.lastRunId,
    lastRunStatus: normalizeRunStatus(patch.lastRunStatus),
    desired: sanitizeDesiredHostSummary(patch.desired, "hosts.patch.desired"),
  };
}

async function upsertHostImpl(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  hostName: string;
  patch: HostPatchInput;
}): Promise<{ hostId: Id<"hosts"> }> {
  const name = ensureBoundedString(params.hostName, "hostName", CONTROL_PLANE_LIMITS.hostName);
  const next = sanitizeHostPatchInput(params.patch);
  const existing = await params.ctx.db
    .query("hosts")
    .withIndex("by_project_host", (q) => q.eq("projectId", params.projectId).eq("hostName", name))
    .unique();
  if (existing) {
    await params.ctx.db.patch(existing._id, next);
    return { hostId: existing._id };
  }
  const hostId = await params.ctx.db.insert("hosts", { projectId: params.projectId, hostName: name, ...next });
  return { hostId };
}

export const upsert = mutation({
  args: HostUpsertArgs,
  returns: v.object({ hostId: v.id("hosts") }),
  handler: async (ctx, { projectId, hostName, patch }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `hosts.upsert:${access.authed.user._id}`, limit: 120, windowMs: 60_000 });

    return await upsertHostImpl({ ctx, projectId, hostName, patch });
  },
});

export const upsertInternal = internalMutation({
  args: HostUpsertArgs,
  returns: v.object({ hostId: v.id("hosts") }),
  handler: async (ctx, { projectId, hostName, patch }) => {
    return await upsertHostImpl({ ctx, projectId, hostName, patch });
  },
});

export const touch = mutation({
  args: { projectId: v.id("projects"), hostName: v.string(), status: v.optional(v.union(...literals(HOST_STATUSES))) },
  returns: v.object({ hostId: v.id("hosts") }),
  handler: async (ctx, { projectId, hostName, status }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({ ctx, key: `hosts.touch:${access.authed.user._id}`, limit: 120, windowMs: 60_000 });

    const name = ensureBoundedString(hostName, "hostName", CONTROL_PLANE_LIMITS.hostName);
    const now = Date.now();
    const existing = await ctx.db
      .query("hosts")
      .withIndex("by_project_host", (q) => q.eq("projectId", projectId).eq("hostName", name))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now, lastStatus: status ?? existing.lastStatus });
      return { hostId: existing._id };
    }
    const hostId = await ctx.db.insert("hosts", {
      projectId,
      hostName: name,
      lastSeenAt: now,
      lastStatus: status ?? "unknown",
    });
    return { hostId };
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(HostDoc),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("hosts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.sort((a, b) => a.hostName.localeCompare(b.hostName));
  },
});
