import type { BootstrapMode, ProvisionerDriver, HostProvisionSpec, HostProvisionSpecBase } from "../types.js";
import type { ProvisioningProvider } from "../../config/providers/index.js";
import type { ClawletsHostConfig } from "../../config/schema.js";
import { assertAwsBootstrapMode } from "./aws/bootstrap.js";
import { awsProvisionerDriver } from "./aws/index.js";
import { buildAwsProvisionSpec } from "./aws/spec.js";
import { assertHetznerBootstrapMode } from "./hetzner/bootstrap.js";
import { hetznerProvisionerDriver } from "./hetzner/index.js";
import { buildHetznerProvisionSpec } from "./hetzner/spec.js";

export type ProvisionSpecBuilder = (params: {
  base: HostProvisionSpecBase;
  hostCfg: ClawletsHostConfig;
  hostName: string;
}) => HostProvisionSpec;

const provisionerDrivers: Record<ProvisioningProvider, ProvisionerDriver> = {
  aws: awsProvisionerDriver,
  hetzner: hetznerProvisionerDriver,
};

const provisionSpecBuilders: Record<ProvisioningProvider, ProvisionSpecBuilder> = {
  aws: buildAwsProvisionSpec,
  hetzner: buildHetznerProvisionSpec,
};

type BootstrapModeValidator = (params: { spec: HostProvisionSpec; mode: BootstrapMode }) => void;

const bootstrapModeValidators: Record<ProvisioningProvider, BootstrapModeValidator> = {
  aws: (params) => {
    if (params.spec.provider !== "aws") {
      throw new Error(`aws bootstrap validator received provider=${params.spec.provider}`);
    }
    assertAwsBootstrapMode({ spec: params.spec, mode: params.mode });
  },
  hetzner: (params) => {
    if (params.spec.provider !== "hetzner") {
      throw new Error(`hetzner bootstrap validator received provider=${params.spec.provider}`);
    }
    assertHetznerBootstrapMode({ spec: params.spec, mode: params.mode });
  },
};

export function getProvisionerDriver(provider: ProvisioningProvider): ProvisionerDriver {
  const driver = provisionerDrivers[provider];
  if (!driver) {
    throw new Error(`unsupported provisioning provider: ${provider}`);
  }
  return driver;
}

export function getProvisionSpecBuilder(provider: ProvisioningProvider): ProvisionSpecBuilder {
  const builder = provisionSpecBuilders[provider];
  if (!builder) {
    throw new Error(`unsupported provisioning provider: ${provider}`);
  }
  return builder;
}

export function assertProvisionerBootstrapMode(params: {
  provider: ProvisioningProvider;
  spec: HostProvisionSpec;
  mode: BootstrapMode;
}): void {
  const validate = bootstrapModeValidators[params.provider];
  if (!validate) {
    throw new Error(`unsupported provisioning provider: ${params.provider}`);
  }
  validate({ spec: params.spec, mode: params.mode });
}

export { provisionerDrivers, provisionSpecBuilders };
