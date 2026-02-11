import { ClawletsConfigSchema, type ClawletsConfig } from "./schema.js";
import { InfraConfigSchema, type InfraConfig } from "./schema-infra.js";
import { OpenClawConfigSchema, OpenClawHostConfigSchema, type OpenClawConfig } from "./schema-openclaw.js";
import { INFRA_CONFIG_SCHEMA_VERSION, OPENCLAW_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";

const STATIC_INFRA_SECRET_NAMES = new Set<string>(["admin_password_hash", "tailscale_auth_key", "restic_password"]);

function inferInfraSecretNames(params: { config: ClawletsConfig }): Set<string> {
  const names = new Set<string>(STATIC_INFRA_SECRET_NAMES);
  for (const hostCfg of Object.values(params.config.hosts || {})) {
    const secretName = String(hostCfg.cache?.netrc?.secretName || "").trim();
    if (hostCfg.cache?.netrc?.enable && secretName) names.add(secretName);
  }
  for (const spec of Object.values(params.config.fleet.secretFiles || {})) {
    const secretName = String((spec as any)?.secretName || "").trim();
    if (secretName) names.add(secretName);
  }
  return names;
}

function partitionFleetSecretEnv(params: {
  config: ClawletsConfig;
  existingInfra?: InfraConfig | null;
  existingOpenclaw?: OpenClawConfig | null;
}): { infra: Record<string, string>; openclaw: Record<string, string> } {
  const infra: Record<string, string> = {};
  const openclaw: Record<string, string> = {};
  const infraEnvKeys = new Set(Object.keys(params.existingInfra?.fleet.secretEnv || {}));
  const openclawEnvKeys = new Set(Object.keys(params.existingOpenclaw?.fleet.secretEnv || {}));
  const infraSecretNames = inferInfraSecretNames({ config: params.config });

  for (const [envVar, secretNameRaw] of Object.entries(params.config.fleet.secretEnv || {})) {
    const secretName = String(secretNameRaw || "").trim();
    if (!secretName) continue;

    if (infraEnvKeys.has(envVar)) {
      infra[envVar] = secretName;
      continue;
    }
    if (openclawEnvKeys.has(envVar)) {
      openclaw[envVar] = secretName;
      continue;
    }
    if (infraSecretNames.has(secretName)) {
      infra[envVar] = secretName;
      continue;
    }
    openclaw[envVar] = secretName;
  }

  return { infra, openclaw };
}

function partitionFleetSecretFiles(params: {
  config: ClawletsConfig;
  existingInfra?: InfraConfig | null;
  existingOpenclaw?: OpenClawConfig | null;
}): { infra: Record<string, any>; openclaw: Record<string, any> } {
  const infra: Record<string, any> = {};
  const openclaw: Record<string, any> = {};
  const infraFileIds = new Set(Object.keys(params.existingInfra?.fleet.secretFiles || {}));
  const openclawFileIds = new Set(Object.keys(params.existingOpenclaw?.fleet.secretFiles || {}));
  const infraSecretNames = inferInfraSecretNames({ config: params.config });

  for (const [fileId, specRaw] of Object.entries(params.config.fleet.secretFiles || {})) {
    const spec = specRaw as any;
    if (!spec || typeof spec !== "object") continue;
    const secretName = String(spec.secretName || "").trim();

    if (infraFileIds.has(fileId)) {
      infra[fileId] = spec;
      continue;
    }
    if (openclawFileIds.has(fileId)) {
      openclaw[fileId] = spec;
      continue;
    }
    if (secretName && infraSecretNames.has(secretName)) {
      infra[fileId] = spec;
      continue;
    }
    openclaw[fileId] = spec;
  }

  return { infra, openclaw };
}

export function getDefaultOpenClawConfig(): OpenClawConfig {
  return OpenClawConfigSchema.parse({
    schemaVersion: OPENCLAW_CONFIG_SCHEMA_VERSION,
    hosts: {},
    fleet: {
      secretEnv: {},
      secretFiles: {},
      gatewayArchitecture: "multi",
      codex: { enable: false, gateways: [] },
    },
  });
}

export function mergeSplitConfigs(params: {
  infra: InfraConfig;
  openclaw: OpenClawConfig | null;
}): ClawletsConfig {
  const openclawConfig = params.openclaw ? OpenClawConfigSchema.parse(params.openclaw) : getDefaultOpenClawConfig();
  const openclawHostNames = Object.keys(openclawConfig.hosts || {});
  const infraHostNames = new Set(Object.keys(params.infra.hosts || {}));

  const unknownOpenclawHosts = openclawHostNames.filter((host) => !infraHostNames.has(host));
  if (unknownOpenclawHosts.length > 0) {
    throw new Error(`openclaw hosts not found in fleet/clawlets.json: ${unknownOpenclawHosts.join(", ")}`);
  }

  const envCollisions = Object.keys(params.infra.fleet.secretEnv || {}).filter((key) =>
    Object.prototype.hasOwnProperty.call(openclawConfig.fleet.secretEnv || {}, key),
  );
  if (envCollisions.length > 0) {
    throw new Error(`fleet.secretEnv collisions between infra/openclaw: ${envCollisions.join(", ")}`);
  }

  const fileCollisions = Object.keys(params.infra.fleet.secretFiles || {}).filter((key) =>
    Object.prototype.hasOwnProperty.call(openclawConfig.fleet.secretFiles || {}, key),
  );
  if (fileCollisions.length > 0) {
    throw new Error(`fleet.secretFiles collisions between infra/openclaw: ${fileCollisions.join(", ")}`);
  }

  const hosts: Record<string, any> = {};
  for (const [hostName, infraHost] of Object.entries(params.infra.hosts || {})) {
    const openclawHost = OpenClawHostConfigSchema.parse(openclawConfig.hosts?.[hostName] || {});
    hosts[hostName] = {
      ...structuredClone(infraHost),
      gatewaysOrder: structuredClone(openclawHost.gatewaysOrder),
      gateways: structuredClone(openclawHost.gateways),
      openclaw: { enable: openclawHost.enable },
      agentModelPrimary: openclawHost.agentModelPrimary,
    };
  }

  const merged = {
    schemaVersion: params.infra.schemaVersion,
    defaultHost: params.infra.defaultHost,
    baseFlake: params.infra.baseFlake,
    fleet: {
      ...structuredClone(params.infra.fleet),
      secretEnv: {
        ...structuredClone(params.infra.fleet.secretEnv || {}),
        ...structuredClone(openclawConfig.fleet.secretEnv || {}),
      },
      secretFiles: {
        ...structuredClone(params.infra.fleet.secretFiles || {}),
        ...structuredClone(openclawConfig.fleet.secretFiles || {}),
      },
      gatewayArchitecture: openclawConfig.fleet.gatewayArchitecture,
      codex: structuredClone(openclawConfig.fleet.codex || { enable: false, gateways: [] }),
    },
    hosts,
  };

  return ClawletsConfigSchema.parse(merged);
}

export function splitFullConfig(params: {
  config: ClawletsConfig;
  existingInfra?: InfraConfig | null;
  existingOpenclaw?: OpenClawConfig | null;
}): { infra: InfraConfig; openclaw: OpenClawConfig } {
  const full = ClawletsConfigSchema.parse(params.config);
  const envPartition = partitionFleetSecretEnv({
    config: full,
    existingInfra: params.existingInfra,
    existingOpenclaw: params.existingOpenclaw,
  });
  const filePartition = partitionFleetSecretFiles({
    config: full,
    existingInfra: params.existingInfra,
    existingOpenclaw: params.existingOpenclaw,
  });

  const infraHosts: Record<string, any> = {};
  const openclawHosts: Record<string, any> = {};

  for (const [hostName, hostCfgRaw] of Object.entries(full.hosts || {})) {
    const hostCfg = hostCfgRaw as any;
    infraHosts[hostName] = {
      enable: hostCfg.enable,
      diskDevice: hostCfg.diskDevice,
      flakeHost: hostCfg.flakeHost,
      targetHost: hostCfg.targetHost,
      theme: hostCfg.theme,
      hetzner: hostCfg.hetzner,
      aws: hostCfg.aws,
      provisioning: hostCfg.provisioning,
      sshExposure: hostCfg.sshExposure,
      tailnet: hostCfg.tailnet,
      cache: hostCfg.cache,
      operator: hostCfg.operator,
      selfUpdate: hostCfg.selfUpdate,
    };

    openclawHosts[hostName] = {
      enable: Boolean(hostCfg?.openclaw?.enable),
      agentModelPrimary: String(hostCfg.agentModelPrimary || "").trim() || "anthropic/claude-opus-4-5",
      gatewaysOrder: Array.isArray(hostCfg.gatewaysOrder) ? hostCfg.gatewaysOrder : [],
      gateways: hostCfg.gateways && typeof hostCfg.gateways === "object" ? hostCfg.gateways : {},
    };
  }

  const infraRaw = {
    schemaVersion: INFRA_CONFIG_SCHEMA_VERSION,
    defaultHost: full.defaultHost,
    baseFlake: full.baseFlake,
    fleet: {
      secretEnv: envPartition.infra,
      secretFiles: filePartition.infra,
      sshAuthorizedKeys: full.fleet.sshAuthorizedKeys,
      sshKnownHosts: full.fleet.sshKnownHosts,
      backups: full.fleet.backups,
    },
    hosts: infraHosts,
  };

  const openclawRaw = {
    schemaVersion: OPENCLAW_CONFIG_SCHEMA_VERSION,
    hosts: openclawHosts,
    fleet: {
      secretEnv: envPartition.openclaw,
      secretFiles: filePartition.openclaw,
      gatewayArchitecture: full.fleet.gatewayArchitecture || "multi",
      codex: full.fleet.codex || { enable: false, gateways: [] },
    },
  };

  return {
    infra: InfraConfigSchema.parse(infraRaw),
    openclaw: OpenClawConfigSchema.parse(openclawRaw),
  };
}
