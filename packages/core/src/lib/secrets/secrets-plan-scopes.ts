import type { SecretSpec, SecretsPlanScope, SecretsPlanScopeSets } from "./secrets-plan.js";

export type SecretsPlanScopeSummary = {
  scope: SecretsPlanScope;
  required: SecretSpec[];
  optional: SecretSpec[];
  requiredNames: string[];
  optionalNames: string[];
};

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values)).toSorted();
}

export function buildSecretsPlanScopes(params: {
  required: SecretSpec[];
  bootstrapRequiredNames: Set<string>;
  updatesRequiredNames: Set<string>;
}): SecretsPlanScopeSets {
  const hostRequired = params.required.filter((spec) => spec.scope === "host");
  const gatewayRequired = params.required.filter((spec) => spec.scope === "gateway");

  const bootstrapRequired = hostRequired.filter((spec) => params.bootstrapRequiredNames.has(spec.name));
  const updatesRequired = hostRequired.filter((spec) => params.updatesRequiredNames.has(spec.name));

  return {
    bootstrapRequired,
    updatesRequired,
    openclawRequired: gatewayRequired,
  };
}

export function resolveSecretsPlanScope(params: {
  scopes: SecretsPlanScopeSets;
  optional: SecretSpec[];
  scope: SecretsPlanScope;
}): SecretsPlanScopeSummary {
  const scope = params.scope;
  const required =
    scope === "bootstrap"
      ? params.scopes.bootstrapRequired
      : scope === "updates"
        ? params.scopes.updatesRequired
        : params.scopes.openclawRequired;

  const optional = params.optional.filter((spec) => (scope === "openclaw" ? spec.scope === "gateway" : spec.scope === "host"));

  return {
    scope,
    required,
    optional,
    requiredNames: uniqSorted(required.map((spec) => spec.name)),
    optionalNames: uniqSorted(optional.map((spec) => spec.name)),
  };
}
