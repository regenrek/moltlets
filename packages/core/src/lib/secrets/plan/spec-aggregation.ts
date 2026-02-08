import { ENV_VAR_HELP } from "../env-vars.js";
import type { SecretSource, SecretSpec, SecretsPlanScopeSets } from "../secrets-plan.js";
import { buildFleetSecretsPlanScopeSets } from "./scope-partition.js";
import { pickPrimarySource, recordSecretSpec, type SecretSpecAccumulator } from "./spec-helpers.js";

type SecretEnvMeta = {
  envVars: Set<string>;
  gateways: Set<string>;
};

function addSecretName(set: Set<string>, secretName: string): void {
  const cleaned = String(secretName || "").trim();
  if (cleaned) set.add(cleaned);
}

export function recordHostRequiredSecretSpec(params: {
  secretSpecs: Map<string, SecretSpecAccumulator>;
  secretName: string;
}): void {
  recordSecretSpec(params.secretSpecs, {
    name: params.secretName,
    kind: "extra",
    scope: "host",
    source: "custom",
    optional: false,
  });
}

export function recordSecretFileSpec(params: {
  secretSpecs: Map<string, SecretSpecAccumulator>;
  secretNamesAll: Set<string>;
  secretNamesRequired: Set<string>;
  secretName: string;
  scope: "host" | "gateway";
  source: SecretSource;
  fileId: string;
  gatewayId?: string;
}): void {
  addSecretName(params.secretNamesAll, params.secretName);
  addSecretName(params.secretNamesRequired, params.secretName);
  recordSecretSpec(params.secretSpecs, {
    name: params.secretName,
    kind: "file",
    scope: params.scope,
    source: params.source,
    optional: false,
    fileId: params.fileId,
    gateway: params.gatewayId,
  });
}

export function recordRequiredEnvSecretSpec(params: {
  secretSpecs: Map<string, SecretSpecAccumulator>;
  secretNamesRequired: Set<string>;
  secretName: string;
  envVar: string;
  sources: Set<SecretSource>;
  gatewayId: string;
  helpOverride?: string;
}): void {
  addSecretName(params.secretNamesRequired, params.secretName);
  recordSecretSpec(params.secretSpecs, {
    name: params.secretName,
    kind: "env",
    scope: "gateway",
    source: pickPrimarySource(params.sources),
    optional: false,
    envVar: params.envVar,
    gateway: params.gatewayId,
    help: params.helpOverride ?? ENV_VAR_HELP[params.envVar],
  });
}

export function recordSecretEnvMeta(params: {
  secretEnvMetaByName: Map<string, SecretEnvMeta>;
  secretName: string;
  envVar: string;
  gatewayId: string;
}): void {
  const secretName = String(params.secretName || "").trim();
  if (!secretName) return;
  const existing = params.secretEnvMetaByName.get(secretName);
  if (!existing) {
    params.secretEnvMetaByName.set(secretName, {
      envVars: new Set(params.envVar ? [params.envVar] : []),
      gateways: new Set(params.gatewayId ? [params.gatewayId] : []),
    });
    return;
  }
  if (params.envVar) existing.envVars.add(params.envVar);
  if (params.gatewayId) existing.gateways.add(params.gatewayId);
}

export function recordOptionalEnvSecretSpecs(params: {
  secretSpecs: Map<string, SecretSpecAccumulator>;
  secretNamesAll: Set<string>;
  secretNamesRequired: Set<string>;
  secretEnvMetaByName: Map<string, SecretEnvMeta>;
  envVarHelpOverrides: Map<string, string>;
}): void {
  for (const secretName of params.secretNamesAll) {
    if (params.secretNamesRequired.has(secretName)) continue;

    const meta = params.secretEnvMetaByName.get(secretName);
    if (!meta) {
      recordSecretSpec(params.secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "gateway",
        source: "custom",
        optional: true,
      });
      continue;
    }

    for (const envVar of meta.envVars) {
      recordSecretSpec(params.secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "gateway",
        source: "custom",
        optional: true,
        envVar,
        help: params.envVarHelpOverrides.get(envVar) ?? ENV_VAR_HELP[envVar],
      });
    }

    for (const gatewayId of meta.gateways) {
      recordSecretSpec(params.secretSpecs, {
        name: secretName,
        kind: "env",
        scope: "gateway",
        source: "custom",
        optional: true,
        gateway: gatewayId,
      });
    }
  }
}

export function finalizeSecretSpecs(secretSpecs: Map<string, SecretSpecAccumulator>): {
  required: SecretSpec[];
  optional: SecretSpec[];
  scopes: SecretsPlanScopeSets;
} {
  const specList: SecretSpec[] = Array.from(secretSpecs.values()).map((spec) => {
    const envVars = Array.from(spec.envVars).toSorted();
    const gateways = Array.from(spec.gateways).toSorted();
    return {
      name: spec.name,
      kind: spec.kind,
      scope: spec.scope,
      source: pickPrimarySource(spec.sources),
      optional: spec.optional || undefined,
      help: spec.help,
      envVars: envVars.length ? envVars : undefined,
      gateways: gateways.length ? gateways : undefined,
      fileId: spec.fileId,
    };
  });

  const byName = (a: SecretSpec, b: SecretSpec) => a.name.localeCompare(b.name);
  const required = specList.filter((spec) => !spec.optional).toSorted(byName);
  const optional = specList.filter((spec) => spec.optional).toSorted(byName);
  const scopes = buildFleetSecretsPlanScopeSets(required);
  return { required, optional, scopes };
}
