import type { MissingSecretConfig } from "../../secrets-plan.js";
import { addMissingSecretFileConfig } from "./missing-config.js";

function isUnsafeTargetPath(targetPath: string): boolean {
  return targetPath.includes("/../") || targetPath.endsWith("/..") || targetPath.includes("\u0000");
}

export function validateHostSecretFileTargetPath(params: {
  missingSecretConfig: MissingSecretConfig[];
  fileId: string;
  targetPath: string;
}): void {
  const targetPath = String(params.targetPath || "");
  if (isUnsafeTargetPath(targetPath)) {
    addMissingSecretFileConfig({
      missingSecretConfig: params.missingSecretConfig,
      scope: "host",
      fileId: params.fileId,
      targetPath,
      message: "fleet.secretFiles targetPath must not contain /../, end with /.., or include NUL",
    });
    return;
  }
  if (!targetPath.startsWith("/var/lib/clawlets/")) {
    addMissingSecretFileConfig({
      missingSecretConfig: params.missingSecretConfig,
      scope: "host",
      fileId: params.fileId,
      targetPath,
      message: "fleet.secretFiles targetPath must be under /var/lib/clawlets/",
    });
  }
}

export function validateGatewaySecretFileTargetPath(params: {
  missingSecretConfig: MissingSecretConfig[];
  hostName: string;
  gatewayId: string;
  fileId: string;
  targetPath: string;
}): void {
  const targetPath = String(params.targetPath || "");
  if (isUnsafeTargetPath(targetPath)) {
    addMissingSecretFileConfig({
      missingSecretConfig: params.missingSecretConfig,
      scope: "gateway",
      gatewayId: params.gatewayId,
      fileId: params.fileId,
      targetPath,
      message:
        `hosts.${params.hostName}.gateways.${params.gatewayId}.profile.secretFiles targetPath must not contain /../, end with /.., or include NUL`,
    });
    return;
  }

  const expectedPrefix = `/var/lib/clawlets/secrets/gateways/${params.gatewayId}/`;
  if (!targetPath.startsWith(expectedPrefix)) {
    addMissingSecretFileConfig({
      missingSecretConfig: params.missingSecretConfig,
      scope: "gateway",
      gatewayId: params.gatewayId,
      fileId: params.fileId,
      targetPath,
      message:
        `hosts.${params.hostName}.gateways.${params.gatewayId}.profile.secretFiles targetPath must be under ${expectedPrefix}`,
    });
  }
}
