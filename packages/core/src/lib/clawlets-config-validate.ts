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

function formatMissing(missing: MissingSecretConfig, hostName: string): string {
  if (missing.kind === "envVar") {
    return `missing secretEnv mapping host=${hostName} bot=${missing.gateway} envVar=${missing.envVar}`;
  }
  return `invalid secret file config host=${hostName} scope=${missing.scope} id=${missing.fileId} targetPath=${missing.targetPath}`;
}

function formatInvariantWarning(w: OpenClawInvariantWarning): string {
  return `host=${w.host} bot=${w.botId} ${w.message} (${w.path})`;
}

function formatSchemaError(hostName: string, botId: string, message: string): string {
  return `host=${hostName} bot=${botId} schema: ${message}`;
}

function formatPlanWarning(w: SecretsPlanWarning, hostName: string): string {
  const gateway = w.gateway ? `bot=${w.gateway} ` : "";
  const path = w.path ? ` path=${w.path}` : "";
  return `host=${hostName} ${gateway}${w.message}${path}`.trim();
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
  const hostName = params.hostName.trim();
  const hostCfg = (params.config.hosts as any)?.[hostName];
  if (!hostCfg) {
    return {
      ok: false,
      errors: [`missing host in config.hosts: ${hostName}`],
      warnings: [],
      missing: [],
      inlineWarnings: [],
      authWarnings: [],
      invariantWarnings: [],
      schemaErrors: {},
    };
  }

  const botsOrder = Array.isArray(hostCfg.botsOrder) ? hostCfg.botsOrder : [];
  for (const botId of botsOrder) {
    const res = buildOpenClawGatewayConfig({ config: params.config, hostName, botId });
    if (res.warnings.length > 0) invariantWarnings.push(...res.warnings);
    const validation = validateClawdbotConfig(res.merged);
    if (!validation.ok) {
      schemaErrors[botId] = validation.errors;
      for (const err of validation.errors) errors.push(formatSchemaError(hostName, botId, err));
    }
  }

  const secretsPlan = buildFleetSecretsPlan({ config: params.config, hostName });
  const missing = secretsPlan.missingSecretConfig || [];
  for (const m of missing) errors.push(formatMissing(m, hostName));

  const envVarAliasMap = buildEnvVarAliasMap();
  for (const botId of botsOrder) {
    const botCfg = (hostCfg.bots as any)?.[botId] || {};
    const profile = (botCfg as any)?.profile || {};
    const baseSecretEnv = buildBaseSecretEnv({
      globalEnv: (params.config.fleet as any)?.secretEnv,
      gatewayEnv: profile?.secretEnv,
      aliasMap: envVarAliasMap,
      warnings: [],
      gateway: botId,
    });
    const derivedSecretEnv = buildDerivedSecretEnv(botCfg);
    const derivedDupes = Object.keys(derivedSecretEnv).filter((envVar) =>
      Object.prototype.hasOwnProperty.call(baseSecretEnv, envVar),
    );
    if (derivedDupes.length > 0) {
      errors.push(`host=${hostName} bot=${botId} secretEnv conflicts with derived hooks/skill env vars: ${derivedDupes.join(",")}`);
    }

    const allowlistRaw = (profile as any)?.secretEnvAllowlist;
    if (allowlistRaw !== null && allowlistRaw !== undefined) {
      if (!Array.isArray(allowlistRaw)) {
        errors.push(`host=${hostName} bot=${botId} secretEnvAllowlist must be a list of env var names`);
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
        errors.push(`host=${hostName} bot=${botId} secretEnvAllowlist contains invalid env var(s): ${invalid.slice(0, 6).join(",")}`);
        continue;
      }

      const expected = secretsPlan.byGateway?.[botId]?.envVarsRequired || [];
      const expectedSet = new Set(expected);
      const missingRequired = expected.filter((envVar) => !allowlist.has(envVar));
      const unused = Array.from(allowlist).filter((envVar) => !expectedSet.has(envVar));
      if (missingRequired.length > 0) {
        const msg = `host=${hostName} bot=${botId} secretEnvAllowlist missing required env vars: ${missingRequired.join(",")}`;
        warnings.push(msg);
        if (params.strict) errors.push(msg);
      }
      if (unused.length > 0) {
        const msg = `host=${hostName} bot=${botId} secretEnvAllowlist contains unused env vars: ${unused.join(",")}`;
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

  for (const w of configWarnings) warnings.push(formatPlanWarning(w, hostName));
  for (const w of authWarnings) warnings.push(formatPlanWarning(w, hostName));
  for (const w of inlineWarnings) warnings.push(formatPlanWarning(w, hostName));
  for (const w of invariantWarnings) warnings.push(formatInvariantWarning(w));

  if (params.strict) {
    for (const w of inlineWarnings) errors.push(formatPlanWarning(w, hostName));
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
