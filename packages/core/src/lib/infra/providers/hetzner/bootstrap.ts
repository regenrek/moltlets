import type { BootstrapMode, HetznerProvisionSpec } from "../../types.js";

export function assertHetznerBootstrapMode(params: {
  spec: HetznerProvisionSpec;
  mode: BootstrapMode;
}): void {
  if (params.mode === "image") {
    const image = String(params.spec.hetzner.image || "").trim();
    if (!image) {
      throw new Error(
        `missing hetzner.image for ${params.spec.hostName} (set via: clawlets host set --hetzner-image <image_id>)`,
      );
    }
  }
}
