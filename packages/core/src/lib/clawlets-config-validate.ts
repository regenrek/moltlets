import type { ClawletsConfig } from "./clawlets-config.js";
import { buildOpenClawGatewayConfig, type OpenClawInvariantWarning } from "./openclaw-config-invariants.js";
import { validateClawdbotConfig } from "./clawdbot-schema-validate.js";
import { buildFleetSecretsPlan } from "./fleet-secrets-plan.js";
import { buildBaseSecretEnv, buildDerivedSecretEnv, buildEnvVarAliasMap, canonicalizeEnvVar } from "./fleet-secrets-plan-helpers.js";
import { EnvVarNameSchema } from "@clawlets/shared/lib/identifiers";
import type { MissingSecretConfig, SecretsPlanWarning } from "./secrets-plan.js";

export type ClawletsConfigValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  missing: MissingSecretConfig[];
  inlineWarnings: SecretsPlanWarning[];
  authWarnings: SecretsPlanWarning[];
  invariantWarnings: OpenClawInvariantWarning[];
  schemaErrors: Record<string, string[]>;
};

function formatMissing(missing: MissingSecretConfig): string {
  if (missing.kind === "envVar") {
    return `missing secretEnv mapping gateway=${missing.gateway} envVar=${missing.envVar}`;
  }
  return `invalid secret file config scope=${missing.scope} id=${missing.fileId} targetPath=${missing.targetPath}`;
}

function formatInvariantWarning(w: OpenClawInvariantWarning): string {
  return `gateway=${w.gateway} ${w.message} (${w.path})`;
}

function formatSchemaError(gatewayId: string, message: string): string {
  return `gateway=${gatewayId} schema: ${message}`;
}

function formatPlanWarning(w: SecretsPlanWarning): string {
  const gateway = w.gateway ? `gateway=${w.gateway} ` : "";
  const path = w.path ? ` path=${w.path}` : "";
  return `${gateway}${w.message}${path}`;
}

export function validateClawletsConfig(params: {
  config: ClawletsConfig;
  hostName: string;
  strict?: boolean;
}): ClawletsConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const schemaErrors: Record<string, string[]> = {};
  const invariantWarnings: OpenClawInvariantWarning[] = [];

  for (const gatewayId of params.config.fleet.gatewayOrder || []) {
    const res = buildOpenClawGatewayConfig({ config: params.config, gatewayId });
    if (res.warnings.length > 0) invariantWarnings.push(...res.warnings);
    const validation = validateClawdbotConfig(res.merged);
    if (!validation.ok) {
      schemaErrors[gatewayId] = validation.errors;
      for (const err of validation.errors) errors.push(formatSchemaError(gatewayId, err));
    }
  }

  const secretsPlan = buildFleetSecretsPlan({ config: params.config, hostName: params.hostName });
  const missing = secretsPlan.missingSecretConfig || [];
  for (const m of missing) errors.push(formatMissing(m));

  const envVarAliasMap = buildEnvVarAliasMap();
  const gatewayOrder = params.config.fleet.gatewayOrder || [];
  for (const gatewayId of gatewayOrder) {
    const gatewayCfg = (params.config.fleet.gateways as any)?.[gatewayId] || {};
    const profile = (gatewayCfg as any)?.profile || {};
    const baseSecretEnv = buildBaseSecretEnv({
      globalEnv: (params.config.fleet as any)?.secretEnv,
      gatewayEnv: profile?.secretEnv,
      aliasMap: envVarAliasMap,
      warnings: [],
      gateway: gatewayId,
    });
    const derivedSecretEnv = buildDerivedSecretEnv(gatewayCfg);
    const derivedDupes = Object.keys(derivedSecretEnv).filter((envVar) =>
      Object.prototype.hasOwnProperty.call(baseSecretEnv, envVar),
    );
    if (derivedDupes.length > 0) {
      errors.push(`gateway=${gatewayId} secretEnv conflicts with derived hooks/skill env vars: ${derivedDupes.join(",")}`);
    }

    const allowlistRaw = (profile as any)?.secretEnvAllowlist;
    if (allowlistRaw !== null && allowlistRaw !== undefined) {
      if (!Array.isArray(allowlistRaw)) {
        errors.push(`gateway=${gatewayId} secretEnvAllowlist must be a list of env var names`);
        continue;
      }
      const allowlist = new Set<string>();
      const invalid: string[] = [];
      for (const entry of allowlistRaw) {
        if (typeof entry !== "string") {
          invalid.push(String(entry ?? ""));
          continue;
        }
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const canonical = canonicalizeEnvVar(trimmed, envVarAliasMap);
        if (!canonical) {
          invalid.push(trimmed);
          continue;
        }
        const parsed = EnvVarNameSchema.safeParse(canonical);
        if (!parsed.success) {
          invalid.push(trimmed);
          continue;
        }
        allowlist.add(canonical);
      }
      if (invalid.length > 0) {
        errors.push(`gateway=${gatewayId} secretEnvAllowlist contains invalid env var(s): ${invalid.slice(0, 6).join(",")}`);
        continue;
      }

      const expected = secretsPlan.byGateway?.[gatewayId]?.envVarsRequired || [];
      const expectedSet = new Set(expected);
      const missingRequired = expected.filter((envVar) => !allowlist.has(envVar));
      const unused = Array.from(allowlist).filter((envVar) => !expectedSet.has(envVar));
      if (missingRequired.length > 0) {
        const msg = `gateway=${gatewayId} secretEnvAllowlist missing required env vars: ${missingRequired.join(",")}`;
        warnings.push(msg);
        if (params.strict) errors.push(msg);
      }
      if (unused.length > 0) {
        const msg = `gateway=${gatewayId} secretEnvAllowlist contains unused env vars: ${unused.join(",")}`;
        warnings.push(msg);
        if (params.strict) errors.push(msg);
      }
    }
  }

  const inlineWarnings = (secretsPlan.warnings || []).filter((w) => w.kind === "inlineToken" || w.kind === "inlineApiKey");
  const authWarnings = (secretsPlan.warnings || []).filter((w) => w.kind === "auth");
  const configWarnings = (secretsPlan.warnings || []).filter(
    (w) => w.kind !== "inlineToken" && w.kind !== "inlineApiKey" && w.kind !== "auth",
  );

  for (const w of configWarnings) warnings.push(formatPlanWarning(w));
  for (const w of authWarnings) warnings.push(formatPlanWarning(w));
  for (const w of inlineWarnings) warnings.push(formatPlanWarning(w));
  for (const w of invariantWarnings) warnings.push(formatInvariantWarning(w));

  if (params.strict) {
    for (const w of inlineWarnings) errors.push(formatPlanWarning(w));
    for (const w of invariantWarnings) errors.push(formatInvariantWarning(w));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    missing,
    inlineWarnings,
    authWarnings,
    invariantWarnings,
    schemaErrors,
  };
}
