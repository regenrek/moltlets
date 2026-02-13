import { z, type RefinementCtx } from "zod";

export const HETZNER_SERVER_TYPES = ["cpx22", "cpx32", "cpx42"] as const;
export type HetznerServerType = (typeof HETZNER_SERVER_TYPES)[number];

export const HETZNER_LOCATIONS = ["nbg1", "fsn1", "hel1", "sin", "hil", "ash"] as const;
export type HetznerLocation = (typeof HETZNER_LOCATIONS)[number];

export const HETZNER_DEFAULT_SERVER_TYPE: HetznerServerType = "cpx32";
export const HETZNER_DEFAULT_LOCATION: HetznerLocation = "fsn1";
export const HETZNER_DEFAULT_VOLUME_SIZE_GB = 0;

export const HetznerHostSchema = z
  .object({
    serverType: z.string().trim().min(1).default(HETZNER_DEFAULT_SERVER_TYPE),
    image: z.string().trim().default(""),
    location: z.string().trim().min(1).default(HETZNER_DEFAULT_LOCATION),
    allowTailscaleUdpIngress: z.boolean().default(true),
    volumeSizeGb: z.number().int().nonnegative().default(HETZNER_DEFAULT_VOLUME_SIZE_GB),
    volumeLinuxDevice: z.string().trim().min(1).optional(),
  })
  .default(() => ({
    serverType: HETZNER_DEFAULT_SERVER_TYPE,
    image: "",
    location: HETZNER_DEFAULT_LOCATION,
    allowTailscaleUdpIngress: true,
    volumeSizeGb: HETZNER_DEFAULT_VOLUME_SIZE_GB,
  }));

export type HetznerHostConfig = z.infer<typeof HetznerHostSchema>;

export function addHetznerProvisioningIssues(params: {
  host: { hetzner: HetznerHostConfig };
  ctx: RefinementCtx;
}): void {
  const hetzner = params.host.hetzner;
  if (!hetzner.serverType.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hetzner", "serverType"],
      message: "hetzner.serverType must be set when provisioning.provider is hetzner",
    });
  }
  if (!hetzner.location.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hetzner", "location"],
      message: "hetzner.location must be set when provisioning.provider is hetzner",
    });
  }
}
