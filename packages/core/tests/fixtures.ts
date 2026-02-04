import type { ClawletsConfig } from "@clawlets/core/lib/clawlets-config";

export const baseHost = {
  enable: false,
  gatewaysOrder: ["agent"],
  gateways: { agent: {} },
  diskDevice: "/dev/sda",
  flakeHost: "",
  targetHost: "admin@host",
  hetzner: { serverType: "cx43", image: "", location: "nbg1" },
  provisioning: { adminCidr: "203.0.113.1/32", adminCidrAllowWorldOpen: false, sshPubkeyFile: "~/.ssh/id_ed25519.pub" },
  sshExposure: { mode: "bootstrap" },
  tailnet: { mode: "tailscale" },
  cache: {
    substituters: ["https://cache.nixos.org", "https://cache.garnix.io"],
    trustedPublicKeys: [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=",
      "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g=",
    ],
    netrc: { enable: false, secretName: "garnix_netrc", path: "/etc/nix/netrc", narinfoCachePositiveTtl: 3600 },
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
} as const;

export function makeConfig(params?: {
  hostName?: string;
  hostOverrides?: Partial<typeof baseHost>;
  fleetOverrides?: Record<string, unknown>;
}): ClawletsConfig {
  const hostName = params?.hostName ?? "alpha";
  const host = { ...baseHost, ...(params?.hostOverrides ?? {}) };
  const fleet = {
    secretEnv: {},
    secretFiles: {},
    sshAuthorizedKeys: [] as string[],
    sshKnownHosts: [] as string[],
    codex: { enable: false, gateways: [] },
    backups: { restic: { enable: false, repository: "" } },
    ...(params?.fleetOverrides ?? {}),
  };
  return {
    schemaVersion: 18,
    defaultHost: hostName,
    baseFlake: "",
    fleet,
    cattle: {
      enabled: false,
      hetzner: {
        image: "",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labels: { "managed-by": "clawlets" },
      },
      defaults: { autoShutdown: true, callbackUrl: "" },
    },
    hosts: { [hostName]: host } as Record<string, typeof host>,
  } as ClawletsConfig;
}
