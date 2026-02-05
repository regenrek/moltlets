import type { ClawletsHostConfig } from "../../../config/schema.js";
import type { AwsProvisionSpec, HostProvisionSpecBase } from "../../types.js";

export function buildAwsProvisionSpec(params: {
  base: HostProvisionSpecBase;
  hostCfg: ClawletsHostConfig;
  hostName: string;
}): AwsProvisionSpec {
  if (params.base.provider !== "aws") {
    throw new Error(`aws spec builder received provider=${params.base.provider}`);
  }

  const region = String(params.hostCfg.aws?.region || "").trim();
  if (!region) throw new Error(`missing aws.region for ${params.hostName} (set via: clawlets host set --aws-region ...)`);

  const instanceType = String(params.hostCfg.aws?.instanceType || "").trim();
  if (!instanceType) {
    throw new Error(`missing aws.instanceType for ${params.hostName} (set via: clawlets host set --aws-instance-type ...)`);
  }

  const amiId = String(params.hostCfg.aws?.amiId || "").trim();
  if (!amiId) {
    throw new Error(`missing aws.amiId for ${params.hostName} (set via: clawlets host set --aws-ami-id ...)`);
  }

  const vpcId = String(params.hostCfg.aws?.vpcId || "").trim();
  const subnetId = String(params.hostCfg.aws?.subnetId || "").trim();
  const useDefaultVpc = Boolean(params.hostCfg.aws?.useDefaultVpc);
  if (useDefaultVpc && (vpcId || subnetId)) {
    throw new Error(`aws.useDefaultVpc cannot be combined with aws.vpcId or aws.subnetId for ${params.hostName}`);
  }
  if (!useDefaultVpc && !vpcId && !subnetId) {
    throw new Error(`missing aws.vpcId or aws.subnetId for ${params.hostName}`);
  }

  return {
    ...params.base,
    provider: "aws",
    aws: { region, instanceType, amiId, vpcId, subnetId, useDefaultVpc },
  };
}
