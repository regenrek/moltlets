import type { ClawletsHostConfig } from "../../../config/schema.js";
import type { HetznerProvisionSpec, HostProvisionSpecBase } from "../../types.js";

export function buildHetznerProvisionSpec(params: {
  base: HostProvisionSpecBase;
  hostCfg: ClawletsHostConfig;
  hostName: string;
}): HetznerProvisionSpec {
  if (params.base.provider !== "hetzner") {
    throw new Error(`hetzner spec builder received provider=${params.base.provider}`);
  }

  const serverType = String(params.hostCfg.hetzner?.serverType || "").trim();
  if (!serverType) {
    throw new Error(`missing hetzner.serverType for ${params.hostName} (set via: clawlets host set --server-type ...)`);
  }

  const image = String(params.hostCfg.hetzner?.image || "").trim();
  const location = String(params.hostCfg.hetzner?.location || "").trim();
  const allowTailscaleUdpIngress = params.hostCfg.hetzner?.allowTailscaleUdpIngress !== false;
  const volumeSizeGb = Math.max(0, Math.trunc(Number(params.hostCfg.hetzner?.volumeSizeGb ?? 0)));
  if (!location) {
    throw new Error(`missing hetzner.location for ${params.hostName} (set via: clawlets host set --hetzner-location ...)`);
  }

  return {
    ...params.base,
    provider: "hetzner",
    hetzner: { serverType, image, location, allowTailscaleUdpIngress, volumeSizeGb },
  };
}
