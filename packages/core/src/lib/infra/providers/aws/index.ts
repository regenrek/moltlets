import type { ProvisionedHost, ProvisionerDriver } from "../../types.js";
import { applyAwsOpenTofu, destroyAwsOpenTofu, readAwsOpenTofuOutput } from "./opentofu.js";

export const awsProvisionerDriver: ProvisionerDriver = {
  id: "aws",
  async provision({ spec, runtime }): Promise<ProvisionedHost> {
    if (spec.provider !== "aws") {
      throw new Error(`aws driver received provider=${spec.provider}`);
    }
    await applyAwsOpenTofu({ spec, runtime });

    const ipv4 = await readAwsOpenTofuOutput({ name: "ipv4", runtime, spec });
    const instanceId = await readAwsOpenTofuOutput({ name: "instance_id", runtime, spec });

    return {
      hostName: spec.hostName,
      provider: "aws",
      instanceId,
      ipv4,
      sshUser: "admin",
    };
  },
  async destroy({ spec, runtime }): Promise<void> {
    if (spec.provider !== "aws") {
      throw new Error(`aws driver received provider=${spec.provider}`);
    }
    await destroyAwsOpenTofu({ spec, runtime });
  },
  async lockdown({ spec, runtime }): Promise<void> {
    if (spec.provider !== "aws") {
      throw new Error(`aws driver received provider=${spec.provider}`);
    }
    await applyAwsOpenTofu({ spec, runtime });
  },
};
