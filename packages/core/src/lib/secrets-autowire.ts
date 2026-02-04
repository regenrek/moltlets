import { buildFleetSecretsPlan } from "./fleet-secrets-plan.js";
import { suggestSecretNameForEnvVar } from "./fleet-secrets-plan-helpers.js";
import type { ClawletsConfig } from "./clawlets-config.js";
import type { MissingSecretConfig, SecretSource } from "./secrets-plan.js";
import { ClawletsConfigSchema } from "./clawlets-config.js";

export type SecretsAutowireScope = "fleet" | "gateway";

export type SecretsAutowireEntry = {
  gatewayId: string;
  envVar: string;
  secretName: string;
  scope: SecretsAutowireScope;
  sources: SecretSource[];
};

export type SecretsAutowirePlan = {
  updates: SecretsAutowireEntry[];
  skipped: MissingSecretConfig[];
};

function pickDefaultScope(sources: SecretSource[]): SecretsAutowireScope {
  if (sources.includes("channel")) return "gateway";
  if (sources.includes("model") || sources.includes("provider")) return "fleet";
  return "gateway";
}

function normalizeEnvVarFilter(list: string[] | undefined): Set<string> | null {
  if (!list || list.length === 0) return null;
  const out = new Set<string>();
  for (const entry of list) {
    const cleaned = String(entry || "").trim();
    if (cleaned) out.add(cleaned);
  }
  return out.size > 0 ? out : null;
}

export function planSecretsAutowire(params: {
  config: ClawletsConfig;
  hostName: string;
  scope?: SecretsAutowireScope;
  gatewayId?: string;
  onlyEnvVars?: string[];
}): SecretsAutowirePlan {
  const plan = buildFleetSecretsPlan({ config: params.config, hostName: params.hostName });
  const onlyEnvVars = normalizeEnvVarFilter(params.onlyEnvVars);
  const targetGateway = params.gatewayId ? String(params.gatewayId).trim() : "";

  const missing = plan.missingSecretConfig || [];
  const updates: SecretsAutowireEntry[] = [];
  const skipped: MissingSecretConfig[] = [];
  const seenFleetEnvVars = new Set<string>();

  for (const entry of missing) {
    if (entry.kind !== "envVar") {
      skipped.push(entry);
      continue;
    }
    if (targetGateway && entry.gateway !== targetGateway) {
      skipped.push(entry);
      continue;
    }
    if (onlyEnvVars && !onlyEnvVars.has(entry.envVar)) {
      skipped.push(entry);
      continue;
    }

    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    const scope = params.scope ?? pickDefaultScope(sources);
    if (scope === "fleet") {
      if (seenFleetEnvVars.has(entry.envVar)) {
        skipped.push(entry);
        continue;
      }
      seenFleetEnvVars.add(entry.envVar);
    }
    const secretName = suggestSecretNameForEnvVar(entry.envVar, scope === "gateway" ? entry.gateway : undefined);
    updates.push({
      gatewayId: entry.gateway,
      envVar: entry.envVar,
      secretName,
      scope,
      sources,
    });
  }

  updates.sort((a, b) => {
    if (a.envVar !== b.envVar) return a.envVar.localeCompare(b.envVar);
    if (a.gatewayId !== b.gatewayId) return a.gatewayId.localeCompare(b.gatewayId);
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.secretName.localeCompare(b.secretName);
  });

  return { updates, skipped };
}

export function applySecretsAutowire(params: {
  config: ClawletsConfig;
  plan: SecretsAutowirePlan;
  hostName: string;
}): ClawletsConfig {
  const next = structuredClone(params.config) as ClawletsConfig;
  const hostName = params.hostName.trim();
  const hostCfg = (next.hosts as any)?.[hostName];
  if (!hostCfg) throw new Error(`missing host in config.hosts: ${hostName}`);

  for (const entry of params.plan.updates) {
    if (entry.scope === "fleet") {
      const existing = next.fleet.secretEnv?.[entry.envVar];
      if (existing && existing !== entry.secretName) {
        throw new Error(`conflict for ${entry.envVar}: fleet.secretEnv already set to ${existing}`);
      }
      next.fleet.secretEnv[entry.envVar] = entry.secretName;
      continue;
    }
    const gateway = (hostCfg.gateways as any)?.[entry.gatewayId];
    if (!gateway) throw new Error(`unknown gateway for host=${hostName}: ${entry.gatewayId}`);
    const profile = gateway.profile;
    if (!profile.secretEnv) profile.secretEnv = {};
    const existing = profile.secretEnv[entry.envVar];
    if (existing && existing !== entry.secretName) {
      throw new Error(`conflict for ${entry.envVar} on gateway ${entry.gatewayId}: profile.secretEnv already set to ${existing}`);
    }
    profile.secretEnv[entry.envVar] = entry.secretName;
  }

  return ClawletsConfigSchema.parse(next);
}
