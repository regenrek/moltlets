import type { ClawletsConfig } from "./clawlets-config.js";
import type { FleetSecretsPlan } from "./secrets/plan.js";
import type { SecretsPlanScope } from "./secrets-plan.js";
import { resolveSecretsPlanScope } from "./secrets-plan-scopes.js";

type SecretsInitTemplateSets = {
  requiresTailscaleAuthKey: boolean;
  requiresAdminPassword: boolean;
  requiredSecrets: string[];
  optionalSecrets: string[];
  templateSecrets: Record<string, string>;
  requiredSecretNames: string[];
  cacheNetrcSecretName: string;
};

export type SecretsInitScope = SecretsPlanScope | "all";

const SKIP_HOST_SECRET_NAMES = new Set(["admin_password_hash", "tailscale_auth_key"]);

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function buildSecretsInitTemplateSets(params: {
  secretsPlan: FleetSecretsPlan;
  hostCfg: ClawletsConfig["hosts"][string];
  scope?: SecretsInitScope;
}): SecretsInitTemplateSets {
  const hostCfg = params.hostCfg;
  const secretsPlan = params.secretsPlan;
  const scope = params.scope ?? "all";

  const scopeSummary =
    scope === "all"
      ? {
          scope,
          required: secretsPlan.required,
          optional: secretsPlan.optional,
          requiredNames: uniqSorted(secretsPlan.required.map((spec) => spec.name)),
          optionalNames: uniqSorted(secretsPlan.optional.map((spec) => spec.name)),
        }
      : resolveSecretsPlanScope({ scopes: secretsPlan.scopes, optional: secretsPlan.optional, scope });

  const requiresTailscaleAuthKey = scopeSummary.requiredNames.includes("tailscale_auth_key");
  const requiresAdminPassword = scopeSummary.requiredNames.includes("admin_password_hash");

  const cacheNetrc = hostCfg.cache?.netrc;
  const cacheNetrcEnabled = Boolean(cacheNetrc?.enable);
  const cacheNetrcSecretName = cacheNetrcEnabled ? String(cacheNetrc?.secretName || "garnix_netrc").trim() : "";
  if (cacheNetrcEnabled && !cacheNetrcSecretName) {
    throw new Error("cache.netrc.secretName must be set when cache.netrc.enable is true");
  }

  const requiredSecrets = uniqSorted(
    scopeSummary.requiredNames.filter((name) => !SKIP_HOST_SECRET_NAMES.has(name)),
  );
  const requiredSecretsSet = new Set(requiredSecrets);
  const optionalSecrets = uniqSorted(
    scopeSummary.optionalNames.filter((name) => !SKIP_HOST_SECRET_NAMES.has(name)),
  );

  const templateSecretNames = uniqSorted([...requiredSecrets, ...optionalSecrets]);
  const templateSecrets: Record<string, string> = {};
  for (const secretName of templateSecretNames) {
    if (cacheNetrcEnabled && secretName === cacheNetrcSecretName) {
      templateSecrets[secretName] = "<REPLACE_WITH_NETRC>";
      continue;
    }
    templateSecrets[secretName] = requiredSecretsSet.has(secretName) ? "<REPLACE_WITH_SECRET>" : "<OPTIONAL>";
  }

  const requiredSecretNames = uniqSorted(scopeSummary.requiredNames);

  return {
    requiresTailscaleAuthKey,
    requiresAdminPassword,
    requiredSecrets,
    optionalSecrets,
    templateSecrets,
    requiredSecretNames,
    cacheNetrcSecretName,
  };
}
