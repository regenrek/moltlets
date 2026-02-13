import { DEFAULT_NIX_SUBSTITUTERS, DEFAULT_NIX_TRUSTED_PUBLIC_KEYS } from "../nix/nix-cache.js";
import { CLAWLETS_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";
import { ClawletsConfigSchema, type ClawletsConfig } from "./schema.js";
import {
  HETZNER_DEFAULT_LOCATION,
  HETZNER_DEFAULT_SERVER_TYPE,
  HETZNER_DEFAULT_VOLUME_SIZE_GB,
} from "./providers/hetzner.js";

export function createDefaultClawletsConfig(params: { host: string; gateways?: string[] }): ClawletsConfig {
  const host = params.host.trim() || "openclaw-fleet-host";
  const gateways = (params.gateways || ["maren", "sonja", "gunnar", "melinda"]).map((id) => id.trim()).filter(Boolean);
  const gatewaysRecord = Object.fromEntries(gateways.map((id) => [id, {}]));
  return ClawletsConfigSchema.parse({
    schemaVersion: CLAWLETS_CONFIG_SCHEMA_VERSION,
    defaultHost: host,
    baseFlake: "",
    fleet: {
      secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      secretFiles: {},
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      codex: { enable: false, gateways: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    hosts: {
      [host]: {
        enable: false,
        gatewaysOrder: gateways,
        gateways: gatewaysRecord,
        openclaw: { enable: false },
        diskDevice: "/dev/sda",
        flakeHost: "",
        hetzner: {
          serverType: HETZNER_DEFAULT_SERVER_TYPE,
          image: "",
          location: HETZNER_DEFAULT_LOCATION,
          allowTailscaleUdpIngress: true,
          volumeSizeGb: HETZNER_DEFAULT_VOLUME_SIZE_GB,
        },
        aws: {
          region: "",
          instanceType: "",
          amiId: "",
          vpcId: "",
          subnetId: "",
          useDefaultVpc: false,
          allowTailscaleUdpIngress: true,
        },
        provisioning: { provider: "hetzner", adminCidr: "", adminCidrAllowWorldOpen: false, sshPubkeyFile: "" },
        sshExposure: { mode: "bootstrap" },
        tailnet: { mode: "tailscale" },
        cache: {
          substituters: Array.from(DEFAULT_NIX_SUBSTITUTERS),
          trustedPublicKeys: Array.from(DEFAULT_NIX_TRUSTED_PUBLIC_KEYS),
          netrc: {
            enable: false,
            secretName: "garnix_netrc",
            path: "/etc/nix/netrc",
            narinfoCachePositiveTtl: 3600,
          },
        },
        operator: { deploy: { enable: false } },
        selfUpdate: {
          enable: false,
          interval: "30min",
          baseUrls: [],
          channel: "prod",
          publicKeys: [],
          previousPublicKeys: [],
          previousPublicKeysValidUntil: "",
          allowUnsigned: false,
          allowRollback: false,
          healthCheckUnit: "",
        },
        agentModelPrimary: "zai/glm-4.7",
      },
    },
  });
}
