import type { findEnvVarRefs } from "../../env-var-refs.js";
import type { SecretFileSpec } from "../../secret-wiring.js";
import type { MissingSecretConfig, SecretSpec, SecretsPlanScopeSets, SecretsPlanWarning } from "../../secrets-plan.js";

export type MissingFleetSecretConfig = MissingSecretConfig;

export type FleetGatewaySecretsPlan = {
  envVarsRequired: string[];
  envVarRefs: ReturnType<typeof findEnvVarRefs>;
  secretEnv: Record<string, string>;
  envVarToSecretName: Record<string, string>;
  secretFiles: Record<string, SecretFileSpec>;
  statefulChannels: string[];
};

export type FleetSecretsPlan = {
  gateways: string[];
  hostSecretNamesRequired: string[];

  secretNamesAll: string[];
  secretNamesRequired: string[];

  required: SecretSpec[];
  optional: SecretSpec[];
  scopes: SecretsPlanScopeSets;
  missing: MissingSecretConfig[];
  warnings: SecretsPlanWarning[];

  missingSecretConfig: MissingSecretConfig[];

  byGateway: Record<string, FleetGatewaySecretsPlan>;

  hostSecretFiles: Record<string, SecretFileSpec>;
};
