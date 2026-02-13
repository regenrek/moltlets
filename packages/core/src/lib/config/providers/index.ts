import { z, type RefinementCtx } from "zod";
import { AwsHostSchema, type AwsHostConfig, addAwsProvisioningIssues } from "./aws.js";
import {
  HETZNER_DEFAULT_LOCATION,
  HETZNER_DEFAULT_SERVER_TYPE,
  HETZNER_DEFAULT_VOLUME_SIZE_GB,
  HETZNER_LOCATIONS,
  HETZNER_SERVER_TYPES,
  HetznerHostSchema,
  type HetznerHostConfig,
  addHetznerProvisioningIssues,
} from "./hetzner.js";

export const PROVISIONING_PROVIDERS = ["hetzner", "aws"] as const;
export const ProvisioningProviderSchema = z.enum(PROVISIONING_PROVIDERS);
export type ProvisioningProvider = z.infer<typeof ProvisioningProviderSchema>;

export {
  AwsHostSchema,
  HetznerHostSchema,
  HETZNER_DEFAULT_SERVER_TYPE,
  HETZNER_DEFAULT_LOCATION,
  HETZNER_DEFAULT_VOLUME_SIZE_GB,
  HETZNER_SERVER_TYPES,
  HETZNER_LOCATIONS,
};
export type { AwsHostConfig, HetznerHostConfig };

export type ProvisioningHostConfig = {
  provisioning?: { provider?: ProvisioningProvider };
  aws: AwsHostConfig;
  hetzner: HetznerHostConfig;
};

const providerValidators: Record<ProvisioningProvider, (host: ProvisioningHostConfig, ctx: RefinementCtx) => void> = {
  aws: (host, ctx) => addAwsProvisioningIssues({ host: { aws: host.aws }, ctx }),
  hetzner: (host, ctx) => addHetznerProvisioningIssues({ host: { hetzner: host.hetzner }, ctx }),
};

export function addProvisioningIssues(params: { host: ProvisioningHostConfig; ctx: RefinementCtx }): void {
  const provider = params.host.provisioning?.provider ?? "hetzner";
  const validate = providerValidators[provider];
  if (validate) {
    validate(params.host, params.ctx);
  }
}
