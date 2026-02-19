import { CONTROL_PLANE_TEXT_LIMITS, SEALED_INPUT_B64_MAX_CHARS } from "@clawlets/core/lib/runtime/control-plane-constants";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { ensureOptionalBoundedString } from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import {
  ProjectCredentialDoc,
} from "../shared/validators";
import {
  ProjectCredentialMetadata,
  ProjectCredentialSection,
  ProjectCredentialSyncStatus,
  RunnerDeployCredsSummary,
} from "../schema";

type ProjectCredentialSectionValue =
  | "hcloudKeyring"
  | "tailscaleKeyring"
  | "githubToken"
  | "sshAuthorizedKeys"
  | "sshKnownHosts";

const DEPLOY_CREDS_KEY_TO_SECTION: Record<string, ProjectCredentialSectionValue> = {
  GITHUB_TOKEN: "githubToken",
  HCLOUD_TOKEN_KEYRING: "hcloudKeyring",
  HCLOUD_TOKEN_KEYRING_ACTIVE: "hcloudKeyring",
  TAILSCALE_AUTH_KEY_KEYRING: "tailscaleKeyring",
  TAILSCALE_AUTH_KEY_KEYRING_ACTIVE: "tailscaleKeyring",
  "fleet.sshAuthorizedKeys": "sshAuthorizedKeys",
  "fleet.sshKnownHosts": "sshKnownHosts",
};

function normalizeMetadata(
  value: {
    status?: "set" | "unset";
    hasActive?: boolean;
    itemCount?: number;
    items?: Array<{ id: string; label: string; maskedValue: string; isActive: boolean }>;
    stringItems?: string[];
  } | undefined,
): {
  status?: "set" | "unset";
  hasActive?: boolean;
  itemCount?: number;
  items?: Array<{ id: string; label: string; maskedValue: string; isActive: boolean }>;
  stringItems?: string[];
} | undefined {
  if (!value) return undefined;
  const items = Array.isArray(value.items) ? value.items.slice(0, 128) : undefined;
  const stringItems = Array.isArray(value.stringItems)
    ? Array.from(
        new Set(
          value.stringItems
            .map((row) => String(row || "").trim())
            .filter(Boolean),
        ),
      ).slice(0, 1_000)
    : undefined;
  return {
    status: value.status,
    hasActive: typeof value.hasActive === "boolean" ? value.hasActive : undefined,
    itemCount:
      typeof value.itemCount === "number" && Number.isFinite(value.itemCount)
        ? Math.max(0, Math.min(10_000, Math.trunc(value.itemCount)))
        : undefined,
    items: items?.map((row) => ({
      id: row.id,
      label: row.label,
      maskedValue: row.maskedValue,
      isActive: row.isActive,
    })),
    stringItems,
  };
}

function normalizeSealedInput(params: {
  sealedValueB64?: string;
  sealedForRunnerId?: Id<"runners">;
  sealedInputAlg?: string;
  sealedInputKeyId?: string;
}): {
  sealedValueB64?: string;
  sealedForRunnerId?: Id<"runners">;
  sealedInputAlg?: string;
  sealedInputKeyId?: string;
} {
  const sealedValueB64 = typeof params.sealedValueB64 === "string" ? params.sealedValueB64.trim() : "";
  const sealedInputAlg = typeof params.sealedInputAlg === "string" ? params.sealedInputAlg.trim() : "";
  const sealedInputKeyId = typeof params.sealedInputKeyId === "string" ? params.sealedInputKeyId.trim() : "";
  const sealedForRunnerId = params.sealedForRunnerId;
  const anyField = Boolean(sealedValueB64 || sealedInputAlg || sealedInputKeyId || sealedForRunnerId);
  if (!anyField) return {};
  if (!sealedValueB64 || !sealedInputAlg || !sealedInputKeyId || !sealedForRunnerId) {
    fail("conflict", "sealed input fields must be provided together");
  }
  if (sealedValueB64.length > SEALED_INPUT_B64_MAX_CHARS) fail("conflict", "sealedValueB64 too large");
  if (!/^[A-Za-z0-9_-]+$/.test(sealedValueB64)) fail("conflict", "sealedValueB64 invalid");
  return {
    sealedValueB64,
    sealedForRunnerId,
    sealedInputAlg,
    sealedInputKeyId,
  };
}

async function upsertProjectCredential(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  section: ProjectCredentialSectionValue;
  metadata?: {
    status?: "set" | "unset";
    hasActive?: boolean;
    itemCount?: number;
    items?: Array<{ id: string; label: string; maskedValue: string; isActive: boolean }>;
    stringItems?: string[];
  };
  syncStatus: "pending" | "synced" | "failed";
  lastSyncError?: string;
  sealedValueB64?: string;
  sealedForRunnerId?: Id<"runners">;
  sealedInputAlg?: string;
  sealedInputKeyId?: string;
  updatedAt: number;
}): Promise<Id<"projectCredentials">> {
  const existing = await params.ctx.db
    .query("projectCredentials")
    .withIndex("by_project_section", (q) => q.eq("projectId", params.projectId).eq("section", params.section))
    .unique();
  const metadata = normalizeMetadata(params.metadata);
  const sealed = normalizeSealedInput({
    sealedValueB64: params.sealedValueB64,
    sealedForRunnerId: params.sealedForRunnerId,
    sealedInputAlg: params.sealedInputAlg,
    sealedInputKeyId: params.sealedInputKeyId,
  });
  const patch = {
    section: params.section,
    ...(metadata ? { metadata } : {}),
    ...sealed,
    syncStatus: params.syncStatus,
    lastSyncError: ensureOptionalBoundedString(
      params.lastSyncError,
      "projectCredentials.lastSyncError",
      CONTROL_PLANE_TEXT_LIMITS.errorMessage,
    ),
    updatedAt: params.updatedAt,
  };
  if (existing) {
    await params.ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await params.ctx.db.insert("projectCredentials", {
    projectId: params.projectId,
    ...patch,
  });
}

function sectionsFromUpdatedKeys(updatedKeys: string[]): ProjectCredentialSectionValue[] {
  const out = new Set<ProjectCredentialSectionValue>();
  for (const row of updatedKeys) {
    const key = String(row || "").trim();
    if (!key) continue;
    const section = DEPLOY_CREDS_KEY_TO_SECTION[key];
    if (section) out.add(section);
  }
  return Array.from(out);
}

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(ProjectCredentialDoc),
  handler: async (ctx, { projectId }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const rows = await ctx.db
      .query("projectCredentials")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return [...rows].sort((a, b) => a.section.localeCompare(b.section));
  },
});

export const upsertPending = mutation({
  args: {
    projectId: v.id("projects"),
    section: ProjectCredentialSection,
    metadata: v.optional(ProjectCredentialMetadata),
    sealedValueB64: v.optional(v.string()),
    sealedForRunnerId: v.optional(v.id("runners")),
    sealedInputAlg: v.optional(v.string()),
    sealedInputKeyId: v.optional(v.string()),
    syncStatus: v.optional(ProjectCredentialSyncStatus),
    lastSyncError: v.optional(v.string()),
  },
  returns: v.object({ credentialId: v.id("projectCredentials") }),
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `projectCredentials.upsertPending:${access.authed.user._id}`,
      limit: 240,
      windowMs: 60_000,
    });

    if (args.sealedForRunnerId) {
      const runner = await ctx.db.get(args.sealedForRunnerId);
      if (!runner || runner.projectId !== args.projectId) fail("not_found", "target runner not found");
    }

    const credentialId = await upsertProjectCredential({
      ctx,
      projectId: args.projectId,
      section: args.section,
      metadata: args.metadata,
      syncStatus: args.syncStatus ?? "pending",
      lastSyncError: args.lastSyncError,
      sealedValueB64: args.sealedValueB64,
      sealedForRunnerId: args.sealedForRunnerId,
      sealedInputAlg: args.sealedInputAlg,
      sealedInputKeyId: args.sealedInputKeyId,
      updatedAt: Date.now(),
    });
    return { credentialId };
  },
});

export const markSyncStatusForUpdatedKeysInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    updatedKeys: v.array(v.string()),
    syncStatus: ProjectCredentialSyncStatus,
    lastSyncError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sections = sectionsFromUpdatedKeys(args.updatedKeys);
    if (sections.length === 0) return null;
    const now = Date.now();
    for (const section of sections) {
      await upsertProjectCredential({
        ctx,
        projectId: args.projectId,
        section,
        syncStatus: args.syncStatus,
        ...(args.lastSyncError ? { lastSyncError: args.lastSyncError } : {}),
        updatedAt: now,
      });
    }
    return null;
  },
});

export const syncFromDeployCredsSummaryInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    summary: RunnerDeployCredsSummary,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await upsertProjectCredential({
      ctx,
      projectId: args.projectId,
      section: "hcloudKeyring",
      metadata: {
        status: args.summary.projectTokenKeyrings.hcloud.hasActive ? "set" : "unset",
        hasActive: args.summary.projectTokenKeyrings.hcloud.hasActive,
        itemCount: args.summary.projectTokenKeyrings.hcloud.itemCount,
        items: args.summary.projectTokenKeyrings.hcloud.items,
      },
      syncStatus: "synced",
      updatedAt: now,
    });
    await upsertProjectCredential({
      ctx,
      projectId: args.projectId,
      section: "tailscaleKeyring",
      metadata: {
        status: args.summary.projectTokenKeyrings.tailscale.hasActive ? "set" : "unset",
        hasActive: args.summary.projectTokenKeyrings.tailscale.hasActive,
        itemCount: args.summary.projectTokenKeyrings.tailscale.itemCount,
        items: args.summary.projectTokenKeyrings.tailscale.items,
      },
      syncStatus: "synced",
      updatedAt: now,
    });
    await upsertProjectCredential({
      ctx,
      projectId: args.projectId,
      section: "githubToken",
      metadata: {
        status: args.summary.hasGithubToken ? "set" : "unset",
      },
      syncStatus: "synced",
      updatedAt: now,
    });
    const sshAuthorizedKeys = Array.isArray(args.summary.fleetSshAuthorizedKeys?.items)
      ? args.summary.fleetSshAuthorizedKeys.items
      : [];
    await upsertProjectCredential({
      ctx,
      projectId: args.projectId,
      section: "sshAuthorizedKeys",
      metadata: {
        status: sshAuthorizedKeys.length > 0 ? "set" : "unset",
        itemCount: sshAuthorizedKeys.length,
        stringItems: sshAuthorizedKeys,
      },
      syncStatus: "synced",
      updatedAt: now,
    });
    const sshKnownHosts = Array.isArray(args.summary.fleetSshKnownHosts?.items)
      ? args.summary.fleetSshKnownHosts.items
      : [];
    await upsertProjectCredential({
      ctx,
      projectId: args.projectId,
      section: "sshKnownHosts",
      metadata: {
        status: sshKnownHosts.length > 0 ? "set" : "unset",
        itemCount: sshKnownHosts.length,
        stringItems: sshKnownHosts,
      },
      syncStatus: "synced",
      updatedAt: now,
    });
    return null;
  },
});
