import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error";
import { CONTROL_PLANE_TEXT_LIMITS } from "@clawlets/core/lib/runtime/control-plane-constants";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireProjectAccessMutation, requireProjectAccessQuery, requireAdmin } from "../shared/auth";
import { ensureBoundedString, ensureOptionalBoundedString, assertNoSecretLikeKeys } from "../shared/controlPlane";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import {
  SetupDraftNonSecret,
  SetupDraftSealedSection,
  SetupDraftStatus,
} from "../schema";

const SETUP_DRAFT_NON_SECRET_TTL_MS = 7 * 24 * 60 * 60_000;
const SETUP_DRAFT_SECRET_TTL_MS = 24 * 60 * 60_000;
const SETUP_DRAFT_MAX_SEALED_INPUT_CHARS = 2 * 1024 * 1024;
const SEALED_INPUT_ALG = "rsa-oaep-3072/aes-256-gcm";

const SetupDraftSection = v.union(v.literal("deployCreds"), v.literal("bootstrapSecrets"));
const SetupDraftSaveStatus = v.union(v.literal("set"), v.literal("missing"));

const SetupDraftSecretSectionView = v.object({
  status: SetupDraftSaveStatus,
  updatedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  targetRunnerId: v.optional(v.id("runners")),
});

const SetupDraftView = v.object({
  draftId: v.id("setupDrafts"),
  hostName: v.string(),
  status: SetupDraftStatus,
  version: v.number(),
  nonSecretDraft: SetupDraftNonSecret,
  sealedSecretDrafts: v.object({
    deployCreds: SetupDraftSecretSectionView,
    bootstrapSecrets: SetupDraftSecretSectionView,
  }),
  updatedAt: v.number(),
  expiresAt: v.number(),
  committedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
});

const SetupDraftCommitPayload = v.object({
  draftId: v.id("setupDrafts"),
  hostName: v.string(),
  status: SetupDraftStatus,
  version: v.number(),
  targetRunnerId: v.id("runners"),
  nonSecretDraft: SetupDraftNonSecret,
  sealedSecretDrafts: v.object({
    deployCreds: SetupDraftSealedSection,
    bootstrapSecrets: SetupDraftSealedSection,
  }),
});

function ensureNoExtraKeys(value: Record<string, unknown>, field: string, keys: string[]): void {
  const extra = Object.keys(value).filter((k) => !keys.includes(k));
  if (extra.length > 0) fail("conflict", `${field} contains unsupported keys: ${extra.join(",")}`);
}

function normalizeHostName(raw: string): string {
  return ensureBoundedString(raw, "hostName", CONTROL_PLANE_TEXT_LIMITS.hostName);
}

function normalizeErrorMessage(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  return ensureOptionalBoundedString(raw, "errorMessage", CONTROL_PLANE_TEXT_LIMITS.errorMessage);
}

function asSetupDraftSectionAad(params: {
  projectId: Id<"projects">;
  hostName: string;
  section: "deployCreds" | "bootstrapSecrets";
  targetRunnerId: Id<"runners">;
}): string {
  return `${params.projectId}:${params.hostName}:setupDraft:${params.section}:${params.targetRunnerId}`;
}

function validateSealedInputB64(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) fail("conflict", "sealedInputB64 required");
  if (value.length > SETUP_DRAFT_MAX_SEALED_INPUT_CHARS) fail("conflict", "sealedInputB64 too large");
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    fail("conflict", "sealedInputB64 contains forbidden characters");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail("conflict", "sealedInputB64 invalid");
  return value;
}

function normalizeSectionPatch(params: {
  patch: Doc<"setupDrafts">["nonSecretDraft"];
}): Doc<"setupDrafts">["nonSecretDraft"] {
  const out: Doc<"setupDrafts">["nonSecretDraft"] = {};
  if (params.patch.infrastructure) {
    const infrastructure = params.patch.infrastructure;
    out.infrastructure = {
      serverType: ensureOptionalBoundedString(
        infrastructure.serverType,
        "nonSecretDraft.infrastructure.serverType",
        CONTROL_PLANE_TEXT_LIMITS.hostName,
      ),
      image: ensureOptionalBoundedString(
        infrastructure.image,
        "nonSecretDraft.infrastructure.image",
        CONTROL_PLANE_TEXT_LIMITS.projectConfigPath,
      ),
      location: ensureOptionalBoundedString(
        infrastructure.location,
        "nonSecretDraft.infrastructure.location",
        CONTROL_PLANE_TEXT_LIMITS.hostName,
      ),
      allowTailscaleUdpIngress:
        typeof infrastructure.allowTailscaleUdpIngress === "boolean"
          ? infrastructure.allowTailscaleUdpIngress
          : undefined,
      volumeEnabled:
        typeof infrastructure.volumeEnabled === "boolean"
          ? infrastructure.volumeEnabled
          : undefined,
      volumeSizeGb:
        typeof infrastructure.volumeSizeGb === "number" && Number.isFinite(infrastructure.volumeSizeGb)
          ? Math.max(0, Math.min(10_240, Math.trunc(infrastructure.volumeSizeGb)))
          : undefined,
    };
  }
  if (params.patch.connection) {
    const connection = params.patch.connection;
    const sshExposureModeRaw = ensureOptionalBoundedString(
      connection.sshExposureMode,
      "nonSecretDraft.connection.sshExposureMode",
      CONTROL_PLANE_TEXT_LIMITS.hostName,
    );
    const sshExposureMode =
      sshExposureModeRaw === "bootstrap" || sshExposureModeRaw === "tailnet" || sshExposureModeRaw === "public"
        ? sshExposureModeRaw
        : sshExposureModeRaw === undefined
          ? undefined
          : fail("conflict", "nonSecretDraft.connection.sshExposureMode invalid");

    out.connection = {
      adminCidr: ensureOptionalBoundedString(
        connection.adminCidr,
        "nonSecretDraft.connection.adminCidr",
        CONTROL_PLANE_TEXT_LIMITS.projectConfigPath,
      ),
      sshExposureMode,
      sshKeyCount:
        typeof connection.sshKeyCount === "number" && Number.isFinite(connection.sshKeyCount)
          ? Math.max(0, Math.min(1_000, Math.trunc(connection.sshKeyCount)))
          : undefined,
      sshAuthorizedKeys: Array.isArray(connection.sshAuthorizedKeys)
        ? Array.from(
            new Set(
              connection.sshAuthorizedKeys
                .map((row) =>
                  ensureOptionalBoundedString(
                    typeof row === "string" ? row : undefined,
                    "nonSecretDraft.connection.sshAuthorizedKeys[]",
                    CONTROL_PLANE_TEXT_LIMITS.projectConfigPath,
                  ),
                )
                .filter((row): row is string => Boolean(row)),
            ),
          )
        : undefined,
    };
  }
  return out;
}

function computeSectionView(
  section: Doc<"setupDrafts">["sealedSecretDrafts"]["deployCreds"] | undefined,
  now: number,
): {
  status: "set" | "missing";
  updatedAt?: number;
  expiresAt?: number;
  targetRunnerId?: Id<"runners">;
} {
  if (!section) return { status: "missing" };
  if (section.expiresAt <= now) return { status: "missing" };
  return {
    status: "set",
    updatedAt: section.updatedAt,
    expiresAt: section.expiresAt,
    targetRunnerId: section.targetRunnerId,
  };
}

function sanitizeDraftView(draft: Doc<"setupDrafts">, now = Date.now()): {
  draftId: Id<"setupDrafts">;
  hostName: string;
  status: Doc<"setupDrafts">["status"];
  version: number;
  nonSecretDraft: Doc<"setupDrafts">["nonSecretDraft"];
  sealedSecretDrafts: {
    deployCreds: {
      status: "set" | "missing";
      updatedAt?: number;
      expiresAt?: number;
      targetRunnerId?: Id<"runners">;
    };
    bootstrapSecrets: {
      status: "set" | "missing";
      updatedAt?: number;
      expiresAt?: number;
      targetRunnerId?: Id<"runners">;
    };
  };
  updatedAt: number;
  expiresAt: number;
  committedAt?: number;
  lastError?: string;
} {
  return {
    draftId: draft._id,
    hostName: draft.hostName,
    status: draft.status,
    version: draft.version,
    nonSecretDraft: draft.nonSecretDraft,
    sealedSecretDrafts: {
      deployCreds: computeSectionView(draft.sealedSecretDrafts.deployCreds, now),
      bootstrapSecrets: computeSectionView(draft.sealedSecretDrafts.bootstrapSecrets, now),
    },
    updatedAt: draft.updatedAt,
    expiresAt: draft.expiresAt,
    committedAt: draft.committedAt,
    lastError: draft.lastError,
  };
}

async function getSetupDraftByHost(params: {
  ctx: MutationCtx | QueryCtx;
  projectId: Id<"projects">;
  hostName: string;
}): Promise<Doc<"setupDrafts"> | null> {
  return await params.ctx.db
    .query("setupDrafts")
    .withIndex("by_project_host", (q) => q.eq("projectId", params.projectId).eq("hostName", params.hostName))
    .unique();
}

async function requireHostForProject(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  hostName: string;
}): Promise<void> {
  const host = await params.ctx.db
    .query("hosts")
    .withIndex("by_project_host", (q) => q.eq("projectId", params.projectId).eq("hostName", params.hostName))
    .unique();
  if (!host) fail("not_found", `unknown host: ${params.hostName}`);
}

async function requireSealedRunner(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runnerId: Id<"runners">;
}): Promise<{ alg: string; keyId: string }> {
  const runner = await params.ctx.db.get(params.runnerId);
  if (!runner || runner.projectId !== params.projectId) fail("not_found", "target runner not found");
  if (runner.lastStatus !== "online") fail("conflict", "target runner offline");
  const caps = runner.capabilities;
  if (!caps?.supportsSealedInput) fail("conflict", "target runner does not support sealed input");
  const alg = String(caps.sealedInputAlg || "").trim();
  const keyId = String(caps.sealedInputKeyId || "").trim();
  if (alg !== SEALED_INPUT_ALG || !keyId) {
    fail("conflict", "target runner sealed-input capabilities incomplete");
  }
  return { alg, keyId };
}

export const get = query({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
  },
  returns: v.union(SetupDraftView, v.null()),
  handler: async (ctx, { projectId, hostName }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const normalizedHostName = normalizeHostName(hostName);
    const draft = await ctx.db
      .query("setupDrafts")
      .withIndex("by_project_host", (q) => q.eq("projectId", projectId).eq("hostName", normalizedHostName))
      .unique();
    if (!draft) return null;
    return sanitizeDraftView(draft);
  },
});

export const getCommitPayload = mutation({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
  },
  returns: SetupDraftCommitPayload,
  handler: async (ctx, { projectId, hostName }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `setupDrafts.getCommitPayload:${access.authed.user._id}`,
      limit: 120,
      windowMs: 60_000,
    });

    const normalizedHostName = normalizeHostName(hostName);
    const draft = await getSetupDraftByHost({ ctx, projectId, hostName: normalizedHostName });
    if (!draft) fail("not_found", "setup draft not found");

    const infra = draft.nonSecretDraft.infrastructure;
    if (!infra?.serverType?.trim() || !infra.location?.trim()) {
      fail("conflict", "infrastructure draft incomplete");
    }
    const connection = draft.nonSecretDraft.connection;
    if (!connection?.adminCidr?.trim()) fail("conflict", "connection draft incomplete");
    if ((connection.sshKeyCount || 0) <= 0) fail("conflict", "connection draft missing SSH key");

    const now = Date.now();
    const deployCreds = draft.sealedSecretDrafts.deployCreds;
    const bootstrapSecrets = draft.sealedSecretDrafts.bootstrapSecrets;
    if (!deployCreds || deployCreds.expiresAt <= now) fail("conflict", "deployCreds draft missing or expired");
    if (!bootstrapSecrets || bootstrapSecrets.expiresAt <= now) {
      fail("conflict", "bootstrapSecrets draft missing or expired");
    }
    if (deployCreds.targetRunnerId !== bootstrapSecrets.targetRunnerId) {
      fail("conflict", "secret sections must target the same runner");
    }

    const version = Math.max(0, Math.trunc(draft.version || 0)) + 1;
    await ctx.db.patch(draft._id, {
      status: "committing",
      version,
      updatedAt: now,
      expiresAt: now + SETUP_DRAFT_NON_SECRET_TTL_MS,
      committedAt: undefined,
      lastError: undefined,
    });

    return {
      draftId: draft._id,
      hostName: draft.hostName,
      status: "committing" as const,
      version,
      targetRunnerId: deployCreds.targetRunnerId,
      nonSecretDraft: draft.nonSecretDraft,
      sealedSecretDrafts: {
        deployCreds,
        bootstrapSecrets,
      },
    };
  },
});

export const saveNonSecret = mutation({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
    expectedVersion: v.optional(v.number()),
    patch: SetupDraftNonSecret,
  },
  returns: SetupDraftView,
  handler: async (ctx, { projectId, hostName, expectedVersion, patch }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `setupDrafts.saveNonSecret:${access.authed.user._id}`,
      limit: 240,
      windowMs: 60_000,
    });

    const normalizedHostName = normalizeHostName(hostName);
    await requireHostForProject({ ctx, projectId, hostName: normalizedHostName });

    if (!patch.infrastructure && !patch.connection) {
      fail("conflict", "patch required");
    }
    const patchRecord = patch as unknown as Record<string, unknown>;
    ensureNoExtraKeys(patchRecord, "patch", ["infrastructure", "connection"]);
    if (patch.infrastructure) {
      ensureNoExtraKeys(
        patch.infrastructure as unknown as Record<string, unknown>,
        "patch.infrastructure",
        ["serverType", "image", "location", "allowTailscaleUdpIngress", "volumeEnabled", "volumeSizeGb"],
      );
    }
    if (patch.connection) {
      ensureNoExtraKeys(
        patch.connection as unknown as Record<string, unknown>,
        "patch.connection",
        ["adminCidr", "sshExposureMode", "sshKeyCount", "sshAuthorizedKeys"],
      );
    }
    assertNoSecretLikeKeys(patch, "setupDraft.patch");

    const normalizedPatch = normalizeSectionPatch({ patch });
    const now = Date.now();
    const current = await getSetupDraftByHost({ ctx, projectId, hostName: normalizedHostName });

    if (!current) {
      const draftId = await ctx.db.insert("setupDrafts", {
        projectId,
        hostName: normalizedHostName,
        status: "draft",
        version: 1,
        nonSecretDraft: normalizedPatch,
        sealedSecretDrafts: {},
        updatedAt: now,
        expiresAt: now + SETUP_DRAFT_NON_SECRET_TTL_MS,
        committedAt: undefined,
        lastError: undefined,
      });
      const inserted = await ctx.db.get(draftId);
      if (!inserted) fail("not_found", "setup draft insert failed");
      return sanitizeDraftView(inserted);
    }

    if (typeof expectedVersion === "number" && Math.trunc(expectedVersion) !== Math.trunc(current.version || 0)) {
      fail("conflict", "setup draft version mismatch");
    }

    const nextVersion = Math.max(0, Math.trunc(current.version || 0)) + 1;
    await ctx.db.patch(current._id, {
      status: "draft",
      version: nextVersion,
      nonSecretDraft: {
        ...current.nonSecretDraft,
        ...normalizedPatch,
      },
      updatedAt: now,
      expiresAt: now + SETUP_DRAFT_NON_SECRET_TTL_MS,
      committedAt: undefined,
      lastError: undefined,
    });
    const updated = await ctx.db.get(current._id);
    if (!updated) fail("not_found", "setup draft not found");
    return sanitizeDraftView(updated);
  },
});

export const saveSealedSection = mutation({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
    section: SetupDraftSection,
    targetRunnerId: v.id("runners"),
    sealedInputB64: v.string(),
    sealedInputAlg: v.string(),
    sealedInputKeyId: v.string(),
    aad: v.string(),
    expectedVersion: v.optional(v.number()),
  },
  returns: SetupDraftView,
  handler: async (ctx, args) => {
    const access = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `setupDrafts.saveSealedSection:${access.authed.user._id}`,
      limit: 240,
      windowMs: 60_000,
    });

    const normalizedHostName = normalizeHostName(args.hostName);
    await requireHostForProject({ ctx, projectId: args.projectId, hostName: normalizedHostName });

    const runner = await requireSealedRunner({
      ctx,
      projectId: args.projectId,
      runnerId: args.targetRunnerId,
    });
    const normalizedAlg = ensureBoundedString(args.sealedInputAlg, "sealedInputAlg", CONTROL_PLANE_TEXT_LIMITS.hash);
    if (normalizedAlg !== SEALED_INPUT_ALG || runner.alg !== normalizedAlg) {
      fail("conflict", "sealedInputAlg mismatch");
    }
    const normalizedKeyId = ensureBoundedString(args.sealedInputKeyId, "sealedInputKeyId", CONTROL_PLANE_TEXT_LIMITS.hash);
    if (normalizedKeyId !== runner.keyId) fail("conflict", "sealedInputKeyId mismatch");

    const normalizedCiphertext = validateSealedInputB64(args.sealedInputB64);
    const normalizedAad = ensureBoundedString(args.aad, "aad", CONTROL_PLANE_TEXT_LIMITS.projectConfigPath);
    const expectedAad = asSetupDraftSectionAad({
      projectId: args.projectId,
      hostName: normalizedHostName,
      section: args.section,
      targetRunnerId: args.targetRunnerId,
    });
    if (normalizedAad !== expectedAad) fail("conflict", "aad mismatch");

    const now = Date.now();
    const sectionValue = {
      alg: normalizedAlg,
      keyId: normalizedKeyId,
      targetRunnerId: args.targetRunnerId,
      sealedInputB64: normalizedCiphertext,
      aad: normalizedAad,
      updatedAt: now,
      expiresAt: now + SETUP_DRAFT_SECRET_TTL_MS,
    } as const;

    const draft = await getSetupDraftByHost({ ctx, projectId: args.projectId, hostName: normalizedHostName });
    if (!draft) {
      const draftId = await ctx.db.insert("setupDrafts", {
        projectId: args.projectId,
        hostName: normalizedHostName,
        status: "draft",
        version: 1,
        nonSecretDraft: {},
        sealedSecretDrafts: {
          [args.section]: sectionValue,
        },
        updatedAt: now,
        expiresAt: now + SETUP_DRAFT_NON_SECRET_TTL_MS,
        committedAt: undefined,
        lastError: undefined,
      });
      const inserted = await ctx.db.get(draftId);
      if (!inserted) fail("not_found", "setup draft insert failed");
      return sanitizeDraftView(inserted);
    }

    if (typeof args.expectedVersion === "number" && Math.trunc(args.expectedVersion) !== Math.trunc(draft.version || 0)) {
      fail("conflict", "setup draft version mismatch");
    }

    const nextVersion = Math.max(0, Math.trunc(draft.version || 0)) + 1;
    await ctx.db.patch(draft._id, {
      status: "draft",
      version: nextVersion,
      sealedSecretDrafts: {
        ...draft.sealedSecretDrafts,
        [args.section]: sectionValue,
      },
      updatedAt: now,
      expiresAt: now + SETUP_DRAFT_NON_SECRET_TTL_MS,
      committedAt: undefined,
      lastError: undefined,
    });
    const updated = await ctx.db.get(draft._id);
    if (!updated) fail("not_found", "setup draft not found");
    return sanitizeDraftView(updated);
  },
});

export const finishCommit = mutation({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
    status: v.union(v.literal("committed"), v.literal("failed")),
    errorMessage: v.optional(v.string()),
  },
  returns: v.union(SetupDraftView, v.null()),
  handler: async (ctx, { projectId, hostName, status, errorMessage }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `setupDrafts.finishCommit:${access.authed.user._id}`,
      limit: 120,
      windowMs: 60_000,
    });

    const normalizedHostName = normalizeHostName(hostName);
    const draft = await getSetupDraftByHost({ ctx, projectId, hostName: normalizedHostName });
    if (!draft) return null;

    const now = Date.now();
    const nextVersion = Math.max(0, Math.trunc(draft.version || 0)) + 1;
    await ctx.db.patch(draft._id, {
      status,
      version: nextVersion,
      updatedAt: now,
      expiresAt: now + SETUP_DRAFT_NON_SECRET_TTL_MS,
      committedAt: status === "committed" ? now : undefined,
      lastError:
        status === "failed"
          ? sanitizeErrorMessage(normalizeErrorMessage(errorMessage) || "setup apply failed", "setup apply failed")
          : undefined,
    });
    const updated = await ctx.db.get(draft._id);
    return updated ? sanitizeDraftView(updated) : null;
  },
});

export const discard = mutation({
  args: {
    projectId: v.id("projects"),
    hostName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { projectId, hostName }) => {
    const access = await requireProjectAccessMutation(ctx, projectId);
    requireAdmin(access.role);
    await rateLimit({
      ctx,
      key: `setupDrafts.discard:${access.authed.user._id}`,
      limit: 120,
      windowMs: 60_000,
    });

    const normalizedHostName = normalizeHostName(hostName);
    const draft = await getSetupDraftByHost({ ctx, projectId, hostName: normalizedHostName });
    if (!draft) return null;
    await ctx.db.delete(draft._id);
    return null;
  },
});

async function purgeExpiredInternalHandler(
  ctx: MutationCtx,
  { limit }: { limit?: number },
): Promise<{ deleted: number }> {
  const now = Date.now();
  const max = Math.max(1, Math.min(500, Math.trunc(limit ?? 100)));
  const rows = await ctx.db
    .query("setupDrafts")
    .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
    .take(max);
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return { deleted: rows.length };
}

export async function __test_purgeExpiredInternalHandler(
  ctx: MutationCtx,
  args: { limit?: number },
) {
  return await purgeExpiredInternalHandler(ctx, args);
}

export const purgeExpiredInternal = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: purgeExpiredInternalHandler,
});
