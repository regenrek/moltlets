import { needsSudo, requireTargetHost } from "../ssh-target.js";
import { upsertYamlScalarLine } from "@clawlets/core/lib/storage/yaml-scalar";
import { SECRETS_PLAN_SCOPES, type SecretsPlanScope } from "@clawlets/core/lib/secrets/secrets-plan";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";

export { needsSudo, requireTargetHost };
export { upsertYamlScalarLine };

export type SecretsScopeArg = SecretsPlanScope | "all";

export function parseSecretsScope(value: unknown): SecretsScopeArg {
  const raw = coerceTrimmedString(value);
  if (!raw) return "all";
  if (raw === "all") return "all";
  if (SECRETS_PLAN_SCOPES.includes(raw as SecretsPlanScope)) return raw as SecretsPlanScope;
  throw new Error(`invalid --scope: ${raw} (expected bootstrap|updates|openclaw|all)`);
}
