import type { ProvisioningProvider } from "../config/providers/index.js";
import type { SshExposureMode, TailnetMode } from "../config/schema-host.js";

export const BOOTSTRAP_MODES = ["nixos-anywhere", "image"] as const;
export type BootstrapMode = (typeof BOOTSTRAP_MODES)[number];

export type HostProvisionSpecBase = {
  hostName: string;
  provider: ProvisioningProvider;
  diskDevice: string;
  sshExposureMode: SshExposureMode;
  tailnetMode: TailnetMode;
  ssh: {
    adminCidr: string;
    adminCidrAllowWorldOpen: boolean;
    publicKeyPath: string;
    publicKey: string;
  };
};

export type HetznerProvisionSpec = HostProvisionSpecBase & {
  provider: "hetzner";
  hetzner: {
    serverType: string;
    image: string;
    location: string;
  };
};

export type AwsProvisionSpec = HostProvisionSpecBase & {
  provider: "aws";
  aws: {
    region: string;
    instanceType: string;
    amiId: string;
    vpcId: string;
    subnetId: string;
    useDefaultVpc: boolean;
    allowTailscaleUdpIngress: boolean;
  };
};

export type HostProvisionSpec = HetznerProvisionSpec | AwsProvisionSpec;

export type ProvisionedHost = {
  hostName: string;
  provider: ProvisioningProvider;
  instanceId: string;
  ipv4: string;
  sshUser: "root" | "admin";
};

export type ProvisionerRuntime = {
  repoRoot: string;
  opentofuDir: string;
  nixBin: string;
  dryRun: boolean;
  redact: string[];
  credentials: {
    hcloudToken?: string;
    githubToken?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsSessionToken?: string;
  };
};

export type ProvisionerDriver = {
  id: ProvisioningProvider;
  provision(params: { spec: HostProvisionSpec; runtime: ProvisionerRuntime }): Promise<ProvisionedHost>;
  destroy(params: { spec: HostProvisionSpec; runtime: ProvisionerRuntime }): Promise<void>;
  lockdown(params: { spec: HostProvisionSpec; runtime: ProvisionerRuntime }): Promise<void>;
};
