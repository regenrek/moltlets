import type { ProvisionerDriver, ProvisionerRuntime, HetznerProvisionSpec, ProvisionedHost } from "../../types.js";
import { applyHetznerOpenTofu, destroyHetznerOpenTofu, readHetznerOpenTofuOutput } from "./opentofu.js";

function requireHcloudToken(runtime: ProvisionerRuntime): string {
  const token = String(runtime.credentials.hcloudToken || "").trim();
  if (!token) {
    throw new Error("missing HCLOUD_TOKEN (set in .clawlets/env or env var; run: clawlets env init)");
  }
  return token;
}

async function applyHetzner(spec: HetznerProvisionSpec, runtime: ProvisionerRuntime): Promise<void> {
  const hcloudToken = requireHcloudToken(runtime);
  await applyHetznerOpenTofu({ spec, runtime, hcloudToken });
}

async function destroyHetzner(spec: HetznerProvisionSpec, runtime: ProvisionerRuntime): Promise<void> {
  const hcloudToken = requireHcloudToken(runtime);
  await destroyHetznerOpenTofu({ spec, runtime, hcloudToken });
}

export const hetznerProvisionerDriver: ProvisionerDriver = {
  id: "hetzner",
  async provision({ spec, runtime }): Promise<ProvisionedHost> {
    if (spec.provider !== "hetzner") {
      throw new Error(`hetzner driver received provider=${spec.provider}`);
    }
    await applyHetzner(spec, runtime);

    const hcloudToken = requireHcloudToken(runtime);
    const ipv4 = await readHetznerOpenTofuOutput({ name: "ipv4", runtime, spec, hcloudToken });
    const instanceId = await readHetznerOpenTofuOutput({ name: "instance_id", runtime, spec, hcloudToken });

    return {
      hostName: spec.hostName,
      provider: "hetzner",
      instanceId,
      ipv4,
      sshUser: "root",
    };
  },
  async destroy({ spec, runtime }): Promise<void> {
    if (spec.provider !== "hetzner") {
      throw new Error(`hetzner driver received provider=${spec.provider}`);
    }
    await destroyHetzner(spec, runtime);
  },
  async lockdown({ spec, runtime }): Promise<void> {
    if (spec.provider !== "hetzner") {
      throw new Error(`hetzner driver received provider=${spec.provider}`);
    }
    await applyHetzner(spec, runtime);
  },
};
