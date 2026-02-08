import { findEnvVarRefs } from "../env-var-refs.js";
import {
  buildBaseSecretEnv,
  buildDerivedSecretEnv,
  buildEnvVarAliasMap,
  canonicalizeEnvVar,
  collectGatewayModels,
  collectDerivedSecretEnvEntries,
  isWhatsAppEnabled,
} from "../env-vars.js";
import type { ClawletsConfig } from "../../config/index.js";
import type { SecretSource, SecretsPlanWarning } from "../secrets-plan.js";
import { buildOpenClawGatewayConfig } from "../../openclaw/index.js";
import { runSecretRequirementCollectors } from "../collectors/registry.js";
import { addMissingEnvVarConfig } from "./missing-config.js";
import { normalizeEnvVarPaths, normalizeSecretFiles, type SecretSpecAccumulator } from "./spec-helpers.js";
import {
  finalizeSecretSpecs,
  recordHostRequiredSecretSpec,
  recordOptionalEnvSecretSpecs,
  recordRequiredEnvSecretSpec,
  recordSecretEnvMeta,
  recordSecretFileSpec,
} from "./spec-aggregation.js";
import { validateGatewaySecretFileTargetPath, validateHostSecretFileTargetPath } from "./target-path-policy.js";
import type { FleetSecretsPlan, MissingFleetSecretConfig } from "./types.js";
import type { SecretsPlanScope } from "../secrets-plan.js";

export type { FleetSecretsPlan, MissingFleetSecretConfig } from "./types.js";

export function buildFleetSecretsPlan(params: {
  config: ClawletsConfig;
  hostName: string;
  scope?: SecretsPlanScope | "all";
}): FleetSecretsPlan {
  const hostName = params.hostName.trim();
  const scope = params.scope ?? "all";
  const hostCfg = params.config.hosts[hostName];
  if (!hostCfg) throw new Error(`missing host in config.hosts: ${hostName}`);

  const gateways = hostCfg.gatewaysOrder;
  const gatewayConfigs = hostCfg.gateways;

  const secretNamesAll = new Set<string>();
  const secretNamesRequired = new Set<string>();
  const missingSecretConfig: MissingFleetSecretConfig[] = [];
  const warnings: SecretsPlanWarning[] = [];
  const secretSpecs = new Map<string, SecretSpecAccumulator>();
  const secretEnvMetaByName = new Map<string, { envVars: Set<string>; gateways: Set<string> }>();
  const envVarHelpOverrides = new Map<string, string>();

  const hostSecretNamesRequired = new Set<string>(["admin_password_hash"]);

  const tailnetMode = String(hostCfg.tailnet?.mode || "none");
  if (tailnetMode === "tailscale") hostSecretNamesRequired.add("tailscale_auth_key");

  const cacheNetrc = hostCfg.cache?.netrc;
  if (cacheNetrc?.enable) {
    const secretName = String(cacheNetrc?.secretName || "garnix_netrc").trim();
    if (secretName) hostSecretNamesRequired.add(secretName);
  }

  const resticEnabled = Boolean(params.config.fleet.backups?.restic?.enable);
  if (resticEnabled) hostSecretNamesRequired.add("restic_password");

  for (const secretName of hostSecretNamesRequired) {
    recordHostRequiredSecretSpec({
      secretSpecs,
      secretName,
    });
  }

  const byGateway: FleetSecretsPlan["byGateway"] = {};

  const hostSecretFiles = normalizeSecretFiles(params.config.fleet.secretFiles);
  for (const [fileId, spec] of Object.entries(hostSecretFiles)) {
    if (!spec?.secretName) continue;

    recordSecretFileSpec({
      secretSpecs,
      secretNamesAll,
      secretNamesRequired,
      secretName: spec.secretName,
      scope: "host",
      source: "custom",
      fileId,
    });

    validateHostSecretFileTargetPath({
      missingSecretConfig,
      fileId,
      targetPath: String(spec.targetPath || ""),
    });
  }

  const fleetSecretEnv = params.config.fleet.secretEnv;

  const envVarAliasMap = buildEnvVarAliasMap();
  const ignoredEnvVars = new Set<string>([
    // Managed by the Nix runtime (generated/injected), not by fleet.secretEnv/profile.secretEnv.
    "OPENCLAW_GATEWAY_TOKEN",
  ]);

  const shouldScanGateways = scope !== "bootstrap";
  const gatewayIds = shouldScanGateways ? gateways : [];

  for (const gatewayId of gatewayIds) {
    const gatewayCfgRaw = gatewayConfigs[gatewayId] || {};
    const gatewayCfg = gatewayCfgRaw as { profile?: { secretEnv?: unknown; secretFiles?: unknown } };
    const profile = gatewayCfg.profile || {};
    const openclaw = buildOpenClawGatewayConfig({ config: params.config, hostName, gatewayId }).merged;

    const baseSecretEnv = buildBaseSecretEnv({
      globalEnv: fleetSecretEnv,
      gatewayEnv: profile.secretEnv,
      aliasMap: envVarAliasMap,
      warnings,
      gateway: gatewayId,
    });
    const derivedEntries = collectDerivedSecretEnvEntries(gatewayCfgRaw);
    const derivedSecretEnv = buildDerivedSecretEnv(gatewayCfgRaw);
    const secretEnv = { ...baseSecretEnv, ...derivedSecretEnv };
    const derivedDupes = derivedEntries
      .map((entry) => entry.envVar)
      .filter((envVar) => Object.prototype.hasOwnProperty.call(baseSecretEnv, envVar));
    for (const entry of derivedEntries) {
      if (entry.help && !envVarHelpOverrides.has(entry.envVar)) {
        envVarHelpOverrides.set(entry.envVar, entry.help);
      }
    }
    if (derivedDupes.length > 0) {
      warnings.push({
        kind: "config",
        gateway: gatewayId,
        message: `secretEnv conflicts with derived hooks/skill env vars: ${derivedDupes.join(",")}`,
      });
    }

    for (const [envVar, secretNameRaw] of Object.entries(secretEnv)) {
      const secretName = String(secretNameRaw || "").trim();
      if (!secretName) continue;
      secretNamesAll.add(secretName);
      recordSecretEnvMeta({
        secretEnvMetaByName,
        secretName,
        envVar,
        gatewayId,
      });
    }

    const envVarRefsRaw = findEnvVarRefs(openclaw);
    const envVarPathsByVar: Record<string, string[]> = {};
    for (const [envVar, paths] of Object.entries(envVarRefsRaw.pathsByVar)) {
      const canonical = canonicalizeEnvVar(envVar, envVarAliasMap);
      if (!canonical) continue;
      if (ignoredEnvVars.has(canonical)) continue;
      envVarPathsByVar[canonical] = (envVarPathsByVar[canonical] || []).concat(paths);
    }
    const envVarRefs = {
      vars: Object.keys(envVarPathsByVar).toSorted(),
      pathsByVar: envVarPathsByVar,
    };

    const requiredEnvBySource = new Map<string, Set<SecretSource>>();
    const addRequiredEnv = (envVar: string, source: SecretSource, path?: string) => {
      const key = canonicalizeEnvVar(envVar, envVarAliasMap);
      if (!key) return;
      const set = requiredEnvBySource.get(key) ?? new Set<SecretSource>();
      set.add(source);
      requiredEnvBySource.set(key, set);
      if (path) {
        envVarPathsByVar[key] = envVarPathsByVar[key] || [];
        envVarPathsByVar[key]!.push(path);
      }
    };

    for (const envVar of envVarRefs.vars) addRequiredEnv(envVar, "custom");
    for (const entry of derivedEntries) addRequiredEnv(entry.envVar, "custom", entry.path);

    const models = collectGatewayModels({ openclaw, hostDefaultModel: String(hostCfg.agentModelPrimary || "") });
    runSecretRequirementCollectors({
      gatewayId,
      hostName,
      openclaw,
      warnings,
      addRequiredEnv,
      envVarHelpOverrides,
      models,
      secretEnv,
      aliasMap: envVarAliasMap,
    });

    const whatsappEnabled = isWhatsAppEnabled(openclaw);
    if (whatsappEnabled) {
      warnings.push({
        kind: "statefulChannel",
        channel: "whatsapp",
        gateway: gatewayId,
        message: "WhatsApp enabled; requires stateful login on the gateway host.",
      });
    }

    normalizeEnvVarPaths(envVarPathsByVar);

    const envVarsRequired = Array.from(requiredEnvBySource.keys()).toSorted();
    const envVarToSecretName: Record<string, string> = {};
    for (const envVar of envVarsRequired) {
      const secretName = String(secretEnv[envVar] || "").trim();
      const sources = requiredEnvBySource.get(envVar) ?? new Set<SecretSource>();
      if (!secretName) {
        addMissingEnvVarConfig({
          missingSecretConfig,
          gatewayId,
          envVar,
          sources,
          paths: envVarPathsByVar[envVar] || [],
        });
        continue;
      }
      envVarToSecretName[envVar] = secretName;
      recordRequiredEnvSecretSpec({
        secretSpecs,
        secretNamesRequired,
        secretName,
        envVar,
        sources,
        gatewayId,
        helpOverride: envVarHelpOverrides.get(envVar),
      });
    }

    const gatewaySecretFiles = normalizeSecretFiles(profile.secretFiles);
    for (const [fileId, spec] of Object.entries(gatewaySecretFiles)) {
      if (!spec?.secretName) continue;

      recordSecretFileSpec({
        secretSpecs,
        secretNamesAll,
        secretNamesRequired,
        secretName: spec.secretName,
        scope: "gateway",
        source: "custom",
        fileId,
        gatewayId,
      });

      validateGatewaySecretFileTargetPath({
        missingSecretConfig,
        hostName,
        gatewayId,
        fileId,
        targetPath: String(spec.targetPath || ""),
      });
    }

    const statefulChannels = whatsappEnabled ? ["whatsapp"] : [];

    byGateway[gatewayId] = {
      envVarsRequired,
      envVarRefs,
      secretEnv,
      envVarToSecretName,
      secretFiles: gatewaySecretFiles,
      statefulChannels,
    };
  }

  recordOptionalEnvSecretSpecs({
    secretSpecs,
    secretNamesAll,
    secretNamesRequired,
    secretEnvMetaByName,
    envVarHelpOverrides,
  });

  const { required, optional, scopes } = finalizeSecretSpecs(secretSpecs);

  return {
    gateways: gatewayIds,
    hostSecretNamesRequired: Array.from(hostSecretNamesRequired).toSorted(),
    secretNamesAll: Array.from(secretNamesAll).toSorted(),
    secretNamesRequired: Array.from(secretNamesRequired).toSorted(),
    required,
    optional,
    scopes,
    missing: missingSecretConfig,
    warnings,
    missingSecretConfig,
    byGateway,
    hostSecretFiles,
  };
}
