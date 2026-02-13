import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const runMock = vi.fn(async () => {});
const ensureKeyMock = vi.fn(async () => "123");

vi.mock("../src/lib/runtime/run.js", () => ({
  run: runMock,
  capture: vi.fn(async () => ""),
  captureWithInput: vi.fn(async () => ""),
}));

vi.mock("../src/lib/infra/providers/hetzner/hcloud.js", () => ({
  ensureHcloudSshKeyId: ensureKeyMock,
}));

describe("opentofu", () => {
  beforeEach(() => {
    runMock.mockClear();
    ensureKeyMock.mockClear();
  });

  it("destroyHetznerOpenTofu runs init + destroy with vars", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-opentofu-"));
    try {
      const opentofuDir = path.join(repoRoot, ".clawlets", "infra", "opentofu");
      const sshPubkeyFile = path.join(repoRoot, "id_ed25519.pub");
      await writeFile(sshPubkeyFile, "ssh-ed25519 AAAATEST test\n", "utf8");

      const { destroyHetznerOpenTofu } = await import("../src/lib/infra/providers/hetzner/opentofu.js");
      await destroyHetznerOpenTofu({
        spec: {
          hostName: "openclaw-fleet-host",
          provider: "hetzner",
          diskDevice: "/dev/sda",
          sshExposureMode: "tailnet",
          tailnetMode: "tailscale",
          ssh: {
            adminCidr: "203.0.113.10/32",
            adminCidrAllowWorldOpen: false,
            publicKeyPath: sshPubkeyFile,
            publicKey: "ssh-ed25519 AAAATEST test",
          },
          hetzner: {
            serverType: "cx43",
            image: "debian-12",
            location: "nbg1",
            allowTailscaleUdpIngress: false,
            volumeSizeGb: 0,
          },
        },
        runtime: {
          repoRoot,
          opentofuDir,
          nixBin: "nix",
          dryRun: false,
          redact: [],
          credentials: { hcloudToken: "token" },
        },
        hcloudToken: "token",
      });

      expect(runMock).toHaveBeenCalledTimes(2);

      const [cmd1, args1, opts1] = runMock.mock.calls[0] as any[];
      expect(cmd1).toBe("nix");
      expect(opts1.cwd).toBe(path.join(opentofuDir, "providers", "hetzner"));
      expect(args1).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "init", "-input=false"]);

      const [cmd2, args2, opts2] = runMock.mock.calls[1] as any[];
      expect(cmd2).toBe("nix");
      expect(opts2.cwd).toBe(path.join(opentofuDir, "providers", "hetzner"));
      expect(args2.slice(0, 5)).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "destroy"]);
      expect(args2).toContain("-auto-approve");
      expect(args2).toContain("-input=false");
      expect(args2).not.toContain("hcloud_token=token");
      expect(args2).toContain("admin_cidr=203.0.113.10/32");
      expect(args2).toContain("admin_cidr_is_world_open=false");
      expect(args2).toContain("ssh_key_id=123");
      expect(args2).toContain("ssh_exposure_mode=tailnet");
      expect(args2).toContain("tailnet_mode=tailscale");
      expect(args2).toContain("tailscale_udp_ingress_enabled=false");
      expect(args2).toContain("volume_size_gb=0");
      expect(args2).toContain("server_type=cx43");
      expect(opts2.env?.HCLOUD_TOKEN).toBe("token");

      expect(ensureKeyMock).toHaveBeenCalledTimes(1);
      expect(ensureKeyMock.mock.calls[0]?.[0]).toMatchObject({ token: "token", name: "clawlets-admin" });
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("destroyAwsOpenTofu runs init + destroy with vars", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-opentofu-aws-"));
    try {
      const opentofuDir = path.join(repoRoot, ".clawlets", "infra", "opentofu");
      const { destroyAwsOpenTofu } = await import("../src/lib/infra/providers/aws/opentofu.js");
      await destroyAwsOpenTofu({
        spec: {
          hostName: "openclaw-fleet-host",
          provider: "aws",
          diskDevice: "/dev/sda",
          sshExposureMode: "bootstrap",
          tailnetMode: "tailscale",
          ssh: {
            adminCidr: "203.0.113.10/32",
            adminCidrAllowWorldOpen: false,
            publicKeyPath: path.join(repoRoot, "id_ed25519.pub"),
            publicKey: "ssh-ed25519 AAAATEST aws-test",
          },
          aws: {
            region: "us-east-1",
            instanceType: "t3.large",
            amiId: "ami-0123456789abcdef0",
            vpcId: "",
            subnetId: "",
            useDefaultVpc: true,
            allowTailscaleUdpIngress: false,
          },
        },
        runtime: {
          repoRoot,
          opentofuDir,
          nixBin: "nix",
          dryRun: false,
          redact: ["aws-secret"],
          credentials: {
            awsAccessKeyId: "AKIA_TEST",
            awsSecretAccessKey: "aws-secret",
            awsSessionToken: "aws-session",
          },
        },
      });

      expect(runMock).toHaveBeenCalledTimes(2);

      const [cmd1, args1, opts1] = runMock.mock.calls[0] as any[];
      expect(cmd1).toBe("nix");
      expect(opts1.cwd).toBe(path.join(opentofuDir, "providers", "aws"));
      expect(args1).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "init", "-input=false"]);

      const [cmd2, args2, opts2] = runMock.mock.calls[1] as any[];
      expect(cmd2).toBe("nix");
      expect(opts2.cwd).toBe(path.join(opentofuDir, "providers", "aws"));
      expect(args2.slice(0, 5)).toEqual(["run", "--impure", "nixpkgs#opentofu", "--", "destroy"]);
      expect(args2).toContain("-auto-approve");
      expect(args2).toContain("-input=false");
      expect(args2).toContain("admin_cidr=203.0.113.10/32");
      expect(args2).toContain("ssh_exposure_mode=bootstrap");
      expect(args2).toContain("tailnet_mode=tailscale");
      expect(args2).toContain("region=us-east-1");
      expect(args2).toContain("instance_type=t3.large");
      expect(args2).toContain("ami_id=ami-0123456789abcdef0");
      expect(args2).toContain("use_default_vpc=true");
      expect(args2).toContain("tailscale_udp_ingress_enabled=false");
      expect(args2).toContain("ssh_public_key=ssh-ed25519 AAAATEST aws-test");
      expect(opts2.env?.AWS_REGION).toBe("us-east-1");
      expect(opts2.env?.AWS_DEFAULT_REGION).toBe("us-east-1");
      expect(opts2.env?.AWS_ACCESS_KEY_ID).toBe("AKIA_TEST");
      expect(opts2.env?.AWS_SECRET_ACCESS_KEY).toBe("aws-secret");
      expect(opts2.env?.AWS_SESSION_TOKEN).toBe("aws-session");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
