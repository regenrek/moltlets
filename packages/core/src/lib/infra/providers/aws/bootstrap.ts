import type { AwsProvisionSpec, BootstrapMode } from "../../types.js";

export function assertAwsBootstrapMode(params: {
  spec: AwsProvisionSpec;
  mode: BootstrapMode;
}): void {
  if (params.mode !== "image") {
    throw new Error("bootstrap mode nixos-anywhere is not supported for provider=aws (phase2-first). Use --mode image.");
  }

  const amiId = String(params.spec.aws.amiId || "").trim();
  if (!amiId) {
    throw new Error(`missing aws.amiId for ${params.spec.hostName} (set via: clawlets host set --aws-ami-id <ami-...>)`);
  }
}
