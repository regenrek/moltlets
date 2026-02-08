import type { MissingSecretConfig, SecretSource } from "../secrets-plan.js";

export function addMissingEnvVarConfig(params: {
  missingSecretConfig: MissingSecretConfig[];
  gatewayId: string;
  envVar: string;
  sources: Set<SecretSource>;
  paths: string[];
}): void {
  params.missingSecretConfig.push({
    kind: "envVar",
    gateway: params.gatewayId,
    envVar: params.envVar,
    sources: Array.from(params.sources).toSorted(),
    paths: params.paths,
  });
}

export function addMissingSecretFileConfig(params: {
  missingSecretConfig: MissingSecretConfig[];
  scope: "host" | "gateway";
  fileId: string;
  targetPath: string;
  message: string;
  gatewayId?: string;
}): void {
  params.missingSecretConfig.push({
    kind: "secretFile",
    scope: params.scope,
    gateway: params.gatewayId,
    fileId: params.fileId,
    targetPath: params.targetPath,
    message: params.message,
  });
}
