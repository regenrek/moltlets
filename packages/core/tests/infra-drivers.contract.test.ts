import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildHostProvisionSpec, getProvisionerDriver } from "../src/lib/infra";

describe("infra driver contracts", () => {
  it("hetzner driver provision/destroy/lockdown satisfy contract in dry-run mode", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-infra-contract-"));
    try {
      const pubkeyPath = path.join(repoRoot, "id_ed25519.pub");
      fs.writeFileSync(pubkeyPath, "ssh-ed25519 AAAATEST contract", "utf8");

      const spec = buildHostProvisionSpec({
        repoRoot,
        hostName: "alpha",
        hostCfg: {
          diskDevice: "/dev/sda",
          provisioning: {
            provider: "hetzner",
            adminCidr: "203.0.113.10/32",
            sshPubkeyFile: pubkeyPath,
          },
          sshExposure: { mode: "bootstrap" },
          tailnet: { mode: "tailscale" },
          hetzner: { serverType: "cx43", location: "nbg1", image: "debian-12" },
        } as any,
      });

      expect(spec.provider).toBe("hetzner");
      const driver = getProvisionerDriver(spec.provider);

      const runtime = {
        repoRoot,
        opentofuDir: path.join(repoRoot, ".clawlets", "infra", "opentofu", "alpha"),
        nixBin: "nix",
        dryRun: true,
        redact: ["token"],
        credentials: {
          hcloudToken: "token",
        },
      };

      const provisioned = await driver.provision({ spec, runtime });
      expect(provisioned.hostName).toBe("alpha");
      expect(provisioned.provider).toBe("hetzner");
      expect(provisioned.instanceId).toContain("opentofu-output");
      expect(provisioned.ipv4).toContain("opentofu-output");

      await expect(driver.lockdown({ spec, runtime })).resolves.toBeUndefined();
      await expect(driver.destroy({ spec, runtime })).resolves.toBeUndefined();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("aws driver provision/destroy/lockdown satisfy contract in dry-run mode", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-infra-contract-aws-"));
    try {
      const pubkeyPath = path.join(repoRoot, "id_ed25519.pub");
      fs.writeFileSync(pubkeyPath, "ssh-ed25519 AAAATEST contract", "utf8");

      const spec = buildHostProvisionSpec({
        repoRoot,
        hostName: "beta",
        hostCfg: {
          diskDevice: "/dev/sda",
          provisioning: {
            provider: "aws",
            adminCidr: "203.0.113.10/32",
            sshPubkeyFile: pubkeyPath,
          },
          sshExposure: { mode: "bootstrap" },
          tailnet: { mode: "tailscale" },
          aws: {
            region: "us-east-1",
            instanceType: "t3.large",
            amiId: "ami-0123456789abcdef0",
            useDefaultVpc: true,
          },
        } as any,
      });

      expect(spec.provider).toBe("aws");
      const driver = getProvisionerDriver(spec.provider);

      const runtime = {
        repoRoot,
        opentofuDir: path.join(repoRoot, ".clawlets", "infra", "opentofu", "beta"),
        nixBin: "nix",
        dryRun: true,
        redact: ["top-secret"],
        credentials: {
          awsAccessKeyId: "AKIA_TEST",
          awsSecretAccessKey: "top-secret",
        },
      };

      const provisioned = await driver.provision({ spec, runtime });
      expect(provisioned.hostName).toBe("beta");
      expect(provisioned.provider).toBe("aws");
      expect(provisioned.instanceId).toContain("opentofu-output");
      expect(provisioned.ipv4).toContain("opentofu-output");

      await expect(driver.lockdown({ spec, runtime })).resolves.toBeUndefined();
      await expect(driver.destroy({ spec, runtime })).resolves.toBeUndefined();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
