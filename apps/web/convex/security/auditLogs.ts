import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Infer } from "convex/values";

import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  requireAuthMutation,
  requireProjectAccessMutation,
  requireProjectAccessQuery,
  requireAdmin,
} from "../shared/auth";
import { fail } from "../shared/errors";
import { rateLimit } from "../shared/rateLimit";
import { AuditLogDoc } from "../shared/validators";
import { AuditAction, AuditData, AuditTarget } from "../schema";

type AuditTargetValue = Infer<typeof AuditTarget>;
type AuditDataValue = Infer<typeof AuditData>;

function ensureBoundedString(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) fail("conflict", `${field} required`);
  if (trimmed.length > max) fail("conflict", `${field} too long`);
  return trimmed;
}

function ensureRepoRelativePath(value: string, field: string, max: number): string {
  const normalized = ensureBoundedString(value, field, max).replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("//")) {
    fail("conflict", `${field} must be repo-relative`);
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    fail("conflict", `${field} must be repo-relative`);
  }
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized.endsWith("/..")) {
    fail("conflict", `${field} must be repo-relative`);
  }
  if (normalized.includes("\0") || normalized.includes("\n") || normalized.includes("\r")) {
    fail("conflict", `${field} invalid`);
  }
  return normalized;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("conflict", `${field} required`);
  }
  return value as Record<string, unknown>;
}

function ensureNoExtraKeys(value: Record<string, unknown>, field: string, keys: string[]): void {
  const extra = Object.keys(value).filter((k) => !keys.includes(k));
  if (extra.length > 0) fail("conflict", `${field} contains unsupported keys: ${extra.join(",")}`);
}

const AUDIT_STRING_ARRAY_MAX_ITEMS = 200;
const AUDIT_STRING_ITEM_MAX_LEN = 256;

function normalizeBoundedStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) fail("conflict", `${field} invalid`);
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") fail("conflict", `${field} invalid`);
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.push(trimmed.length > AUDIT_STRING_ITEM_MAX_LEN ? trimmed.slice(0, AUDIT_STRING_ITEM_MAX_LEN) : trimmed);
    if (out.length >= AUDIT_STRING_ARRAY_MAX_ITEMS) break;
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error("crypto.subtle.digest unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeBoundedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out.push(trimmed.length > AUDIT_STRING_ITEM_MAX_LEN ? trimmed.slice(0, AUDIT_STRING_ITEM_MAX_LEN) : trimmed);
    if (out.length >= AUDIT_STRING_ARRAY_MAX_ITEMS) break;
  }
  return out;
}

function requireRunId(data: Record<string, unknown>): { runId: Id<"runs"> } {
  ensureNoExtraKeys(data, "data", ["runId"]);
  if (typeof data.runId !== "string" || !data.runId.trim()) fail("conflict", "data.runId required");
  return { runId: data.runId as Id<"runs"> };
}

function requireHostTarget(target: Record<string, unknown>): { host: string } {
  ensureNoExtraKeys(target, "target", ["host"]);
  if (typeof target.host !== "string") fail("conflict", "target.host required");
  return { host: ensureBoundedString(target.host, "target.host", 128) };
}

function requireGatewayTarget(target: Record<string, unknown>): { gatewayId: string } {
  ensureNoExtraKeys(target, "target", ["gatewayId"]);
  if (typeof target.gatewayId !== "string") fail("conflict", "target.gatewayId required");
  return { gatewayId: ensureBoundedString(target.gatewayId, "target.gatewayId", 128) };
}

export const listByProjectPage = query({
  args: { projectId: v.id("projects"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(AuditLogDoc),
  handler: async (ctx, { projectId, paginationOpts }) => {
    await requireProjectAccessQuery(ctx, projectId);
    const numItems = Math.max(1, Math.min(200, paginationOpts.numItems));
    const res = await ctx.db
      .query("auditLogs")
      .withIndex("by_project_ts", (q) => q.eq("projectId", projectId))
      .order("desc")
      .paginate({ ...paginationOpts, numItems });

    const page = await Promise.all(
      res.page.map(async (row) => {
        const base = {
          _id: row._id,
          _creationTime: row._creationTime,
          ts: row.ts,
          userId: row.userId,
          projectId: row.projectId,
          action: row.action,
        };
        const rowData =
          row.data && typeof row.data === "object" && !Array.isArray(row.data)
            ? (row.data as Record<string, unknown>)
            : {};

        if (row.action === "deployCreds.update") {
          const updatedKeys = safeBoundedStringArray(rowData.updatedKeys);
          const runId =
            typeof rowData.runId === "string" && rowData.runId.trim()
              ? (rowData.runId as Id<"runs">)
              : undefined;
          return {
            ...base,
            target: { doc: ".clawlets/env" },
            data: runId ? { runId, updatedKeys } : { updatedKeys },
          };
        }

        if (row.action === "sops.operatorKey.generate") {
          const projectIdStr = row.projectId ? String(row.projectId) : "";
          const operatorId =
            typeof rowData.operatorId === "string" ? String(rowData.operatorId).trim() : "";
          if (projectIdStr && operatorId) {
            const hash = await sha256Hex(`${projectIdStr}:${operatorId}`);
            return {
              ...base,
              target: { doc: ".clawlets/keys/operators" },
              data: { operatorIdHash: `sha256:${hash}` },
            };
          }
          const operatorIdHash =
            typeof rowData.operatorIdHash === "string" ? String(rowData.operatorIdHash).trim() : "";
          return {
            ...base,
            target: { doc: ".clawlets/keys/operators" },
            data: operatorIdHash ? { operatorIdHash } : undefined,
          };
        }

        return {
          ...base,
          target: row.target,
          data: row.data,
        };
      }),
    );

    return { ...res, page };
  },
});

export const append = mutation({
  args: {
    projectId: v.id("projects"),
    action: AuditAction,
    target: v.optional(AuditTarget),
    data: v.optional(AuditData),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireAuthMutation(ctx);
    await rateLimit({ ctx, key: `audit.append:${user._id}`, limit: 120, windowMs: 60_000 });

    const { role } = await requireProjectAccessMutation(ctx, args.projectId);
    requireAdmin(role);

    const targetRaw = args.target ? asObject(args.target, "target") : null;
    const dataRaw = args.data ? asObject(args.data, "data") : null;

    let target: AuditTargetValue | undefined;
    let data: AuditDataValue | undefined;

    switch (args.action) {
      case "bootstrap": {
        const t = asObject(targetRaw, "target");
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(t, "target", ["host", "mode"]);
        ensureNoExtraKeys(d, "data", ["runId"]);
        if (typeof t.host !== "string") fail("conflict", "target.host required");
        if (t.mode !== "nixos-anywhere" && t.mode !== "image") fail("conflict", "target.mode invalid");
        const mode = t.mode === "nixos-anywhere" ? "nixos-anywhere" : "image";
        const run = requireRunId(d);
        target = { host: ensureBoundedString(t.host, "target.host", 128), mode };
        data = { runId: run.runId };
        break;
      }
      case "config.migrate": {
        const t = asObject(targetRaw, "target");
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(t, "target", ["to", "file"]);
        ensureNoExtraKeys(d, "data", ["runId", "warnings"]);
        if (typeof t.to !== "number" || !Number.isInteger(t.to)) fail("conflict", "target.to invalid");
        if (typeof t.file !== "string") fail("conflict", "target.file required");
        const warnings = normalizeBoundedStringArray(d.warnings, "data.warnings");
        const run = requireRunId({ runId: d.runId });
        target = { to: t.to, file: ensureRepoRelativePath(t.file, "target.file", 128) };
        data = { runId: run.runId, warnings };
        break;
      }
      case "deployCreds.update": {
        const t = asObject(targetRaw, "target");
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(t, "target", ["doc"]);
        ensureNoExtraKeys(d, "data", ["runId", "updatedKeys"]);
        if (typeof t.doc !== "string") fail("conflict", "target.doc required");
        const runId =
          d.runId === undefined
            ? undefined
            : (typeof d.runId === "string" && d.runId.trim()
                ? (d.runId as Id<"runs">)
                : fail("conflict", "data.runId invalid"));
        const updatedKeys = normalizeBoundedStringArray(d.updatedKeys, "data.updatedKeys");
        target = { doc: ensureRepoRelativePath(t.doc, "target.doc", 128) };
        data = runId ? { runId, updatedKeys } : { updatedKeys };
        break;
      }
      case "gateway.openclaw.harden": {
        const t = requireGatewayTarget(asObject(targetRaw, "target"));
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(d, "data", ["runId", "changesCount", "warningsCount"]);
        const run = requireRunId({ runId: d.runId });
        if (typeof d.changesCount !== "number" || d.changesCount < 0) fail("conflict", "data.changesCount invalid");
        if (typeof d.warningsCount !== "number" || d.warningsCount < 0) fail("conflict", "data.warningsCount invalid");
        target = t;
        data = { runId: run.runId, changesCount: Math.trunc(d.changesCount), warningsCount: Math.trunc(d.warningsCount) };
        break;
      }
      case "gateway.openclaw.write": {
        target = requireGatewayTarget(asObject(targetRaw, "target"));
        data = requireRunId(asObject(dataRaw, "data"));
        break;
      }
      case "gateway.preset.apply": {
        const t = requireGatewayTarget(asObject(targetRaw, "target"));
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(d, "data", ["preset", "runId", "warnings"]);
        if (typeof d.preset !== "string") fail("conflict", "data.preset required");
        const warnings = normalizeBoundedStringArray(d.warnings, "data.warnings");
        const run = requireRunId({ runId: d.runId });
        target = t;
        data = { preset: ensureBoundedString(d.preset, "data.preset", 128), runId: run.runId, warnings };
        break;
      }
      case "lockdown":
      case "secrets.sync":
      case "server.audit":
      case "server.update.apply": {
        target = requireHostTarget(asObject(targetRaw, "target"));
        data = requireRunId(asObject(dataRaw, "data"));
        break;
      }
      case "openclaw.schema.live.fetch": {
        const t = asObject(targetRaw, "target");
        ensureNoExtraKeys(t, "target", ["host", "gatewayId"]);
        if (typeof t.host !== "string") fail("conflict", "target.host required");
        if (typeof t.gatewayId !== "string") fail("conflict", "target.gatewayId required");
        target = {
          host: ensureBoundedString(t.host, "target.host", 128),
          gatewayId: ensureBoundedString(t.gatewayId, "target.gatewayId", 128),
        };
        if (dataRaw) fail("conflict", "data not allowed for openclaw.schema.live.fetch");
        data = undefined;
        break;
      }
      case "project.delete.start": {
        const t = asObject(targetRaw, "target");
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(t, "target", ["projectId"]);
        ensureNoExtraKeys(d, "data", ["tokenExpiresAt"]);
        if (typeof t.projectId !== "string") fail("conflict", "target.projectId required");
        if (typeof d.tokenExpiresAt !== "number" || !Number.isFinite(d.tokenExpiresAt)) fail("conflict", "data.tokenExpiresAt invalid");
        target = { projectId: t.projectId as Id<"projects"> };
        data = { tokenExpiresAt: d.tokenExpiresAt };
        break;
      }
      case "project.delete.confirm": {
        const t = asObject(targetRaw, "target");
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(t, "target", ["projectId"]);
        ensureNoExtraKeys(d, "data", ["deletionJobId"]);
        if (typeof t.projectId !== "string") fail("conflict", "target.projectId required");
        if (typeof d.deletionJobId !== "string") fail("conflict", "data.deletionJobId required");
        target = { projectId: t.projectId as Id<"projects"> };
        data = { deletionJobId: d.deletionJobId as Id<"projectDeletionJobs"> };
        break;
      }
      case "project.policy.update": {
        const t = asObject(targetRaw, "target");
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(t, "target", ["projectId"]);
        ensureNoExtraKeys(d, "data", ["retentionDays", "gitWritePolicy"]);
        if (typeof t.projectId !== "string") fail("conflict", "target.projectId required");
        if (typeof d.retentionDays !== "number" || !Number.isInteger(d.retentionDays)) fail("conflict", "data.retentionDays invalid");
        if (d.gitWritePolicy !== "pr_only" && d.gitWritePolicy !== "direct_commit_enabled") fail("conflict", "data.gitWritePolicy invalid");
        const gitWritePolicy = d.gitWritePolicy === "direct_commit_enabled" ? "direct_commit_enabled" : "pr_only";
        target = { projectId: t.projectId as Id<"projects"> };
        data = { retentionDays: d.retentionDays, gitWritePolicy };
        break;
      }
      case "secrets.init":
      case "secrets.verify": {
        const t = requireHostTarget(asObject(targetRaw, "target"));
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(d, "data", ["runId", "scope"]);
        const run = requireRunId({ runId: d.runId });
        if (d.scope !== "bootstrap" && d.scope !== "updates" && d.scope !== "openclaw" && d.scope !== "all") {
          fail("conflict", "data.scope invalid");
        }
        const scope = d.scope === "bootstrap"
          ? "bootstrap"
          : d.scope === "updates"
            ? "updates"
            : d.scope === "openclaw"
              ? "openclaw"
              : "all";
        target = t;
        data = { runId: run.runId, scope };
        break;
      }
      case "secrets.write": {
        const t = requireHostTarget(asObject(targetRaw, "target"));
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(d, "data", ["secrets"]);
        const secrets = normalizeBoundedStringArray(d.secrets, "data.secrets");
        target = t;
        data = { secrets };
        break;
      }
      case "server.channels": {
        const t = asObject(targetRaw, "target");
        ensureNoExtraKeys(t, "target", ["host", "gatewayId", "op"]);
        if (typeof t.host !== "string") fail("conflict", "target.host required");
        if (typeof t.gatewayId !== "string") fail("conflict", "target.gatewayId required");
        if (t.op !== "status" && t.op !== "capabilities" && t.op !== "login" && t.op !== "logout") {
          fail("conflict", "target.op invalid");
        }
        const op = t.op === "status" ? "status" : t.op === "capabilities" ? "capabilities" : t.op === "login" ? "login" : "logout";
        target = {
          host: ensureBoundedString(t.host, "target.host", 128),
          gatewayId: ensureBoundedString(t.gatewayId, "target.gatewayId", 128),
          op,
        };
        data = requireRunId(asObject(dataRaw, "data"));
        break;
      }
      case "server.restart": {
        const t = asObject(targetRaw, "target");
        ensureNoExtraKeys(t, "target", ["host", "unit"]);
        if (typeof t.host !== "string") fail("conflict", "target.host required");
        if (typeof t.unit !== "string") fail("conflict", "target.unit required");
        target = {
          host: ensureBoundedString(t.host, "target.host", 128),
          unit: ensureBoundedString(t.unit, "target.unit", 200),
        };
        data = requireRunId(asObject(dataRaw, "data"));
        break;
      }
      case "sops.operatorKey.generate": {
        const t = asObject(targetRaw, "target");
        const d = asObject(dataRaw, "data");
        ensureNoExtraKeys(t, "target", ["doc"]);
        ensureNoExtraKeys(d, "data", ["operatorIdHash"]);
        if (typeof t.doc !== "string") fail("conflict", "target.doc required");
        if (typeof d.operatorIdHash !== "string") fail("conflict", "data.operatorIdHash required");
        const operatorIdHash = ensureBoundedString(d.operatorIdHash, "data.operatorIdHash", 80);
        if (!/^sha256:[0-9a-f]{64}$/.test(operatorIdHash)) {
          fail("conflict", "data.operatorIdHash invalid");
        }
        target = { doc: ensureRepoRelativePath(t.doc, "target.doc", 128) };
        data = { operatorIdHash };
        break;
      }
      case "workspace.common.write": {
        const t = asObject(targetRaw, "target");
        ensureNoExtraKeys(t, "target", ["doc"]);
        if (typeof t.doc !== "string") fail("conflict", "target.doc required");
        target = { doc: ensureRepoRelativePath(t.doc, "target.doc", 128) };
        data = requireRunId(asObject(dataRaw, "data"));
        break;
      }
      case "workspace.gateway.reset":
      case "workspace.gateway.write": {
        const t = asObject(targetRaw, "target");
        ensureNoExtraKeys(t, "target", ["gatewayId", "doc"]);
        if (typeof t.gatewayId !== "string") fail("conflict", "target.gatewayId required");
        if (typeof t.doc !== "string") fail("conflict", "target.doc required");
        target = {
          gatewayId: ensureBoundedString(t.gatewayId, "target.gatewayId", 128),
          doc: ensureRepoRelativePath(t.doc, "target.doc", 128),
        };
        data = requireRunId(asObject(dataRaw, "data"));
        break;
      }
      default:
        fail("conflict", "unsupported audit action");
    }

    await ctx.db.insert("auditLogs", {
      ts: Date.now(),
      userId: user._id,
      projectId: args.projectId,
      action: args.action,
      target,
      data,
    });
    return null;
  },
});

export function normalizeBoundedStringArrayForAudit(value: unknown): string[] {
  return normalizeBoundedStringArray(value, "value");
}

export function ensureAuditRepoRelativePath(value: string): string {
  return ensureRepoRelativePath(value, "value", 128);
}
