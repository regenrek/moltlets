import { describe, expect, it } from "vitest";

describe("openclaw passthrough validation", () => {
  it("rejects additional properties under hosts.<host>.gateways.<gateway>.openclaw", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const res = ClawletsConfigSchema.safeParse({
      schemaVersion: 1,
      hosts: {
        "openclaw-fleet-host": {
          enable: false,
          gatewaysOrder: ["maren"],
          gateways: { maren: { openclaw: { extra: 1 } } },
          diskDevice: "/dev/sda",
          sshExposure: { mode: "tailnet" },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    const issue = res.error.issues.find(
      (i) => i.path.join(".") === "hosts.openclaw-fleet-host.gateways.maren.openclaw.extra",
    );
    expect(issue?.message).toMatch(/^hosts\.openclaw-fleet-host\.gateways\.maren\.openclaw\.extra:/);
  });

  it("points exact path for type errors", async () => {
    const { ClawletsConfigSchema } = await import("../src/lib/clawlets-config");
    const res = ClawletsConfigSchema.safeParse({
      schemaVersion: 1,
      hosts: {
        "openclaw-fleet-host": {
          enable: false,
          gatewaysOrder: ["maren"],
          gateways: { maren: { openclaw: { commands: { native: 123 } } } },
          diskDevice: "/dev/sda",
          sshExposure: { mode: "tailnet" },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    const issue = res.error.issues.find(
      (i) => i.path.join(".") === "hosts.openclaw-fleet-host.gateways.maren.openclaw.commands.native",
    );
    expect(issue?.message).toMatch(/^hosts\.openclaw-fleet-host\.gateways\.maren\.openclaw\.commands\.native:/);
  });
});
