import { describe, it, expect } from "vitest";

import { ClawletsConfigSchema } from "../src/lib/clawlets-config";
import { buildOpenClawGatewayConfig } from "../src/lib/openclaw-config-invariants";
import { skillApiKeyEnvVar } from "../src/lib/fleet-secrets-plan-helpers";

const baseHost = {
  enable: false,
  diskDevice: "/dev/sda",
  sshExposure: { mode: "tailnet" },
  tailnet: { mode: "none" },
  agentModelPrimary: "zai/glm-4.7",
};

describe("openclaw gateway config builder", () => {
  it("merges typed surfaces into openclaw config", () => {
    const config = ClawletsConfigSchema.parse({
      schemaVersion: 1,
      hosts: {
        "openclaw-fleet-host": {
          ...baseHost,
          gatewaysOrder: ["main"],
          gateways: {
            main: {
              channels: { discord: { enabled: true } },
              hooks: { tokenSecret: "hooks_token" },
              skills: { entries: { "brave-search": { apiKeySecret: "brave_api_key" } } },
              plugins: { enabled: true },
            },
          },
        },
      },
    });

    const res = buildOpenClawGatewayConfig({ config, hostName: "openclaw-fleet-host", gatewayId: "main" });
    const expectedEnvVar = skillApiKeyEnvVar("brave-search");

    expect((res.merged as any).channels?.discord?.enabled).toBe(true);
    expect((res.merged as any).hooks?.token).toBe("${OPENCLAW_HOOKS_TOKEN}");
    expect((res.merged as any).skills?.entries?.["brave-search"]?.apiKey).toBe(`\${${expectedEnvVar}}`);
    expect((res.merged as any).plugins?.enabled).toBe(true);
  });

  it("keeps agents.list entries in merged config", () => {
    const agentsList = [
      { id: "primary", default: true, name: "Primary" },
      { id: "support", name: "Support" },
    ];
    const config = ClawletsConfigSchema.parse({
      schemaVersion: 1,
      hosts: {
        "openclaw-fleet-host": {
          ...baseHost,
          gatewaysOrder: ["main"],
          gateways: {
            main: {
              agents: { list: agentsList },
            },
          },
        },
      },
    });

    const res = buildOpenClawGatewayConfig({ config, hostName: "openclaw-fleet-host", gatewayId: "main" });
    expect((res.merged as any).agents?.list).toEqual(agentsList);
  });
});
