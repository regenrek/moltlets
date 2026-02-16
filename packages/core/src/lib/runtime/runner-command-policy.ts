import { RUN_KINDS } from "./run-constants.js";
import { CONTROL_PLANE_TEXT_LIMITS, SECRET_WIRING_SCOPES } from "./control-plane-constants.js";
import { validateArgsForKind } from "./runner-command-policy-args.js";
import { validateGitRepoUrlPolicy } from "@clawlets/shared/lib/repo-url-policy";

type SecretScope = (typeof SECRET_WIRING_SCOPES)[number] | "all";
export type RunnerCommandExecutable = "clawlets" | "git";

export type RunnerCommandPayloadMeta = {
  hostName?: string;
  gatewayId?: string;
  scope?: SecretScope;
  secretNames?: string[];
  updatedKeys?: string[];
  sealedInputKeys?: string[];
  configPaths?: string[];
  args?: string[];
  note?: string;
  repoUrl?: string;
  branch?: string;
  depth?: number;
  templateRepo?: string;
  templatePath?: string;
  templateRef?: string;
};

type PayloadValidationResult =
  | { ok: true; payloadMeta: RunnerCommandPayloadMeta; kind: string }
  | { ok: false; error: string };

const EXTRA_ALLOWED_JOB_KINDS = ["secrets_write"] as const;
const ALLOWED_JOB_KINDS = new Set<string>([...RUN_KINDS, ...EXTRA_ALLOWED_JOB_KINDS]);
const SECRET_SCOPES = new Set(["bootstrap", "updates", "openclaw", "all"]);
const TEMPLATE_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TEMPLATE_PATH_RE = /^[A-Za-z0-9._/-]+$/;
const TEMPLATE_REF_RE = /^[A-Za-z0-9._/-]+$/;
const JOB_KIND_RE = /^[A-Za-z0-9._-]+$/;

const META_MAX = {
  note: 1024,
  argsCount: 200,
  argsToken: 512 * 1024,
  argsTotal: 2 * 1024 * 1024,
  repoUrl: 1024,
  branch: 256,
  templatePath: 256,
  templateRef: 128,
  configPath: CONTROL_PLANE_TEXT_LIMITS.projectConfigPath,
  secretName: CONTROL_PLANE_TEXT_LIMITS.secretName,
  gatewayId: CONTROL_PLANE_TEXT_LIMITS.gatewayId,
  hostName: CONTROL_PLANE_TEXT_LIMITS.hostName,
} as const;

function hasForbiddenText(value: string): boolean {
  return value.includes("\0") || value.includes("\n") || value.includes("\r");
}

function ensureBoundedText(params: { value: string; field: string; max: number }): string {
  const trimmed = String(params.value || "").trim();
  if (!trimmed) throw new Error(`${params.field} required`);
  if (trimmed.length > params.max) throw new Error(`${params.field} too long`);
  if (hasForbiddenText(trimmed)) throw new Error(`${params.field} contains forbidden characters`);
  return trimmed;
}

function ensureOptionalBoundedText(params: { value: unknown; field: string; max: number }): string | undefined {
  if (typeof params.value !== "string") return undefined;
  const trimmed = params.value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > params.max) throw new Error(`${params.field} too long`);
  if (hasForbiddenText(trimmed)) throw new Error(`${params.field} contains forbidden characters`);
  return trimmed;
}

function ensureOptionalStringArray(params: {
  value: unknown;
  field: string;
  maxItems: number;
  maxItemLen: number;
}): string[] | undefined {
  if (!Array.isArray(params.value)) return undefined;
  if (params.value.length > params.maxItems) throw new Error(`${params.field} too many items`);
  const out: string[] = [];
  for (let i = 0; i < params.value.length; i += 1) {
    if (typeof params.value[i] !== "string") throw new Error(`${params.field}[${i}] invalid`);
    out.push(
      ensureBoundedText({
        value: params.value[i] as string,
        field: `${params.field}[${i}]`,
        max: params.maxItemLen,
      }),
    );
  }
  return out.length > 0 ? out : undefined;
}

function ensureArgs(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.length > META_MAX.argsCount) throw new Error("payloadMeta.args too many items");
  const out: string[] = [];
  let totalBytes = 0;
  const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
  for (let i = 0; i < value.length; i += 1) {
    const token = value[i];
    if (typeof token !== "string") throw new Error(`payloadMeta.args[${i}] invalid`);
    if (!token) throw new Error(`payloadMeta.args[${i}] empty`);
    if (token === "--") throw new Error("payloadMeta.args cannot include `--`");
    if (hasForbiddenText(token)) throw new Error(`payloadMeta.args[${i}] contains forbidden characters`);
    if (token.length > META_MAX.argsToken) throw new Error(`payloadMeta.args[${i}] too long`);
    // Must run in Convex (no Node Buffer); count UTF-8 bytes via TextEncoder.
    // Fallback is conservative (ASCII) if TextEncoder is unavailable.
    totalBytes += encoder ? encoder.encode(token).length : token.length;
    if (totalBytes > META_MAX.argsTotal) throw new Error("payloadMeta.args too large");
    out.push(token);
  }
  return out;
}

function ensureOptionalDepth(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("payloadMeta.depth invalid");
  const depth = Math.trunc(value);
  if (depth < 1 || depth > 1000) throw new Error("payloadMeta.depth out of range");
  return depth;
}

function ensureRepoUrl(value: unknown): string | undefined {
  const repoUrl = ensureOptionalBoundedText({ value, field: "payloadMeta.repoUrl", max: META_MAX.repoUrl });
  if (!repoUrl) return undefined;
  const validated = validateGitRepoUrlPolicy(repoUrl);
  if (!validated.ok) {
    // Map shared policy errors onto existing core error surface for compatibility.
    if (validated.error.code === "file_forbidden") throw new Error("payloadMeta.repoUrl file: urls are forbidden");
    if (validated.error.code === "invalid_protocol") throw new Error("payloadMeta.repoUrl invalid protocol");
    if (validated.error.code === "host_not_allowed") throw new Error("payloadMeta.repoUrl host is not allowed");
    if (validated.error.code === "invalid_host") throw new Error("payloadMeta.repoUrl invalid host");
    throw new Error("payloadMeta.repoUrl invalid");
  }
  return validated.repoUrl;
}

function ensureBranch(value: unknown): string | undefined {
  const branch = ensureOptionalBoundedText({ value, field: "payloadMeta.branch", max: META_MAX.branch });
  if (!branch) return undefined;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("payloadMeta.branch invalid");
  return branch;
}

function ensureTemplateRepo(value: unknown): string | undefined {
  const repo = ensureOptionalBoundedText({ value, field: "payloadMeta.templateRepo", max: META_MAX.gatewayId });
  if (!repo) return undefined;
  if (!TEMPLATE_REPO_RE.test(repo)) throw new Error("payloadMeta.templateRepo must be owner/repo");
  return repo;
}

function ensureTemplatePath(value: unknown): string | undefined {
  const templatePath = ensureOptionalBoundedText({ value, field: "payloadMeta.templatePath", max: META_MAX.templatePath });
  if (!templatePath) return undefined;
  if (templatePath.startsWith("/")) throw new Error("payloadMeta.templatePath must be relative");
  if (templatePath.includes("..") || !TEMPLATE_PATH_RE.test(templatePath)) throw new Error("payloadMeta.templatePath invalid");
  return templatePath;
}

function ensureTemplateRef(value: unknown): string | undefined {
  const templateRef = ensureOptionalBoundedText({ value, field: "payloadMeta.templateRef", max: META_MAX.templateRef });
  if (!templateRef) return undefined;
  if (!TEMPLATE_REF_RE.test(templateRef)) throw new Error("payloadMeta.templateRef invalid");
  return templateRef;
}

function normalizePayloadMeta(raw: unknown): RunnerCommandPayloadMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const scopeRaw = ensureOptionalBoundedText({
    value: row.scope,
    field: "payloadMeta.scope",
    max: CONTROL_PLANE_TEXT_LIMITS.secretName,
  });
  const scope = scopeRaw
    ? (() => {
        if (!SECRET_SCOPES.has(scopeRaw)) throw new Error("payloadMeta.scope invalid");
        return scopeRaw as SecretScope;
      })()
    : undefined;
  return {
    hostName: ensureOptionalBoundedText({ value: row.hostName, field: "payloadMeta.hostName", max: META_MAX.hostName }),
    gatewayId: ensureOptionalBoundedText({ value: row.gatewayId, field: "payloadMeta.gatewayId", max: META_MAX.gatewayId }),
    scope,
    secretNames: ensureOptionalStringArray({
      value: row.secretNames,
      field: "payloadMeta.secretNames",
      maxItems: 512,
      maxItemLen: META_MAX.secretName,
    }),
    updatedKeys: ensureOptionalStringArray({
      value: row.updatedKeys,
      field: "payloadMeta.updatedKeys",
      maxItems: 512,
      maxItemLen: META_MAX.secretName,
    }),
    sealedInputKeys: ensureOptionalStringArray({
      value: row.sealedInputKeys,
      field: "payloadMeta.sealedInputKeys",
      maxItems: 64,
      maxItemLen: META_MAX.secretName,
    }),
    configPaths: ensureOptionalStringArray({
      value: row.configPaths,
      field: "payloadMeta.configPaths",
      maxItems: 512,
      maxItemLen: META_MAX.configPath,
    }),
    args: ensureArgs(row.args),
    note: ensureOptionalBoundedText({ value: row.note, field: "payloadMeta.note", max: META_MAX.note }),
    repoUrl: ensureRepoUrl(row.repoUrl),
    branch: ensureBranch(row.branch),
    depth: ensureOptionalDepth(row.depth),
    templateRepo: ensureTemplateRepo(row.templateRepo),
    templatePath: ensureTemplatePath(row.templatePath),
    templateRef: ensureTemplateRef(row.templateRef),
  };
}

function validateStructuredPayload(kind: string, payloadMeta: RunnerCommandPayloadMeta): { ok: true } | { ok: false; error: string } {
  if (kind === "project_init") {
    if (payloadMeta.args?.length) return { ok: false, error: "project_init forbids payloadMeta.args" };
    return { ok: true };
  }
  if (kind === "project_import") {
    if (payloadMeta.args?.length) return { ok: false, error: "project_import forbids payloadMeta.args" };
    if (!payloadMeta.repoUrl) return { ok: false, error: "project_import requires payloadMeta.repoUrl" };
    return { ok: true };
  }
  if (kind === "custom" && (!payloadMeta.args || payloadMeta.args.length === 0)) {
    return { ok: false, error: "custom job requires payloadMeta.args" };
  }
  return { ok: true };
}

export function buildCreateImportCommand(
  kind: string,
  payloadMeta: RunnerCommandPayloadMeta,
): { exec: RunnerCommandExecutable; args: string[] } | null {
  if (kind === "project_init") {
    const args = ["project", "init", "--dir", "."];
    if (payloadMeta.hostName) args.push("--host", payloadMeta.hostName);
    if (payloadMeta.templateRepo) args.push("--template", payloadMeta.templateRepo);
    if (payloadMeta.templatePath) args.push("--templatePath", payloadMeta.templatePath);
    if (payloadMeta.templateRef) args.push("--templateRef", payloadMeta.templateRef);
    return { exec: "clawlets", args };
  }
  if (kind === "project_import") {
    const args = ["clone", "--depth", String(payloadMeta.depth ?? 1), "--single-branch"];
    if (payloadMeta.branch) args.push("--branch", payloadMeta.branch);
    args.push(payloadMeta.repoUrl || "", ".");
    return { exec: "git", args };
  }
  return null;
}

export function buildDefaultArgsForJobKind(params: {
  kind: string;
  payloadMeta?: RunnerCommandPayloadMeta;
}): string[] | null {
  const payloadMeta = params.payloadMeta || {};
  const host = payloadMeta.hostName ? ["--host", payloadMeta.hostName] : [];
  const scope = payloadMeta.scope ? ["--scope", payloadMeta.scope] : [];
  switch (params.kind) {
    case "doctor":
      return ["doctor", ...host];
    case "bootstrap":
      return ["bootstrap", ...host, "--json"];
    case "lockdown":
      return ["lockdown", ...host];
    case "secrets_verify":
    case "secrets_verify_bootstrap":
    case "secrets_verify_openclaw":
      return ["secrets", "verify", ...host, ...scope];
    case "secrets_sync":
      return ["secrets", "sync", ...host];
    case "secrets_init":
      return ["secrets", "init", ...host, ...scope];
    default:
      return null;
  }
}

export function validateRunnerJobPayload(params: {
  kind: string;
  payloadMeta?: unknown;
}): PayloadValidationResult {
  try {
    const kind = ensureBoundedText({
      value: params.kind,
      field: "kind",
      max: CONTROL_PLANE_TEXT_LIMITS.jobKind,
    });
    if (!JOB_KIND_RE.test(kind)) return { ok: false, error: "kind invalid" };
    if (!ALLOWED_JOB_KINDS.has(kind)) return { ok: false, error: `job kind not allowlisted: ${kind}` };
    const payloadMeta = normalizePayloadMeta(params.payloadMeta);

    const structured = validateStructuredPayload(kind, payloadMeta);
    if (!structured.ok) return structured;
    if (kind === "custom" && payloadMeta.args && payloadMeta.args[0] === "plugin") {
      return { ok: false, error: "custom plugin commands are forbidden" };
    }
    if (payloadMeta.args && payloadMeta.args.length > 0) {
      const validate = validateArgsForKind(kind, payloadMeta.args);
      if (!validate.ok) return validate;
    }
    return { ok: true, payloadMeta, kind };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

export function __test_validateArgsForKind(params: { kind: string; args: string[] }): { ok: true } | { ok: false; error: string } {
  return validateArgsForKind(params.kind, params.args);
}
