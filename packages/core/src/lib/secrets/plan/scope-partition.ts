import { buildSecretsPlanScopes } from "../../secrets-plan-scopes.js";
import type { SecretSpec, SecretsPlanScopeSets } from "../../secrets-plan.js";

const UPDATE_ONLY_HOST_SECRET_NAMES = new Set<string>(["restic_password"]);

export function buildFleetSecretsPlanScopeSets(required: SecretSpec[]): SecretsPlanScopeSets {
  const hostRequiredNames = required.filter((spec) => spec.scope === "host").map((spec) => spec.name);
  const bootstrapRequiredNames = new Set(hostRequiredNames.filter((name) => !UPDATE_ONLY_HOST_SECRET_NAMES.has(name)));
  const updatesRequiredNames = new Set(hostRequiredNames);
  return buildSecretsPlanScopes({
    required,
    bootstrapRequiredNames,
    updatesRequiredNames,
  });
}
