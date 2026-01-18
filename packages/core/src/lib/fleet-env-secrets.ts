import { getModelRequiredEnvVars } from "./llm-provider-env.js";
import type { ClawdletsConfig } from "./clawdlets-config.js";

function readStringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
    if (typeof vv !== "string") continue;
    const key = String(k || "").trim();
    const value = vv.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

function extractEnvVarsFromString(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const out: string[] = [];
  for (const match of value.matchAll(ENV_VAR_PATTERN)) {
    const name = String(match[1] || "").trim();
    if (name) out.push(name);
  }
  return out;
}

function collectRequiredEnvVarsFromClawdbot(clawdbot: any): string[] {
  const required = new Set<string>();
  const discord = clawdbot?.channels?.discord;
  if (discord && typeof discord === "object" && !Array.isArray(discord)) {
    if (discord.enabled !== false) {
      for (const envVar of extractEnvVarsFromString(discord.token)) required.add(envVar);
    }
  }
  return Array.from(required);
}

function collectBotModels(params: { clawdbot: any; hostDefaultModel: string }): string[] {
  const models: string[] = [];

  const hostDefaultModel = String(params.hostDefaultModel || "").trim();
  const defaults = params.clawdbot?.agents?.defaults;

  const pushModel = (v: unknown) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s) models.push(s);
  };

  const readModelSpec = (spec: unknown) => {
    if (typeof spec === "string") {
      pushModel(spec);
      return;
    }
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return;
    pushModel((spec as any).primary);
    const fallbacks = (spec as any).fallbacks;
    if (Array.isArray(fallbacks)) {
      for (const f of fallbacks) pushModel(f);
    }
  };

  readModelSpec(defaults?.model);
  readModelSpec(defaults?.imageModel);

  if (models.length === 0 && hostDefaultModel) models.push(hostDefaultModel);

  return Array.from(new Set(models));
}

export type EnvSecretMappingMissing = {
  bot: string;
  envVar: string;
  model: string;
};

export type FleetEnvSecretsPlan = {
  bots: string[];
  envSecretsByBot: Record<string, Record<string, string>>;
  secretNamesAll: string[];
  secretNamesRequired: string[];
  envVarsBySecretName: Record<string, string[]>;
  missingEnvSecretMappings: EnvSecretMappingMissing[];
};

export function buildFleetEnvSecretsPlan(params: { config: ClawdletsConfig; hostName: string }): FleetEnvSecretsPlan {
  const hostName = params.hostName.trim();
  const hostCfg = (params.config.hosts as any)?.[hostName];
  if (!hostCfg) throw new Error(`missing host in config.hosts: ${hostName}`);

  const bots = params.config.fleet.botOrder || [];
  const fleetEnvSecrets = params.config.fleet.envSecrets || {};
  const botConfigs = (params.config.fleet.bots || {}) as Record<string, unknown>;

  const envSecretsByBot: Record<string, Record<string, string>> = {};
  const secretNamesAll = new Set<string>();
  const secretNamesRequired = new Set<string>();
  const envVarsBySecretName = new Map<string, Set<string>>();
  const missingEnvSecretMappings: EnvSecretMappingMissing[] = [];

  for (const bot of bots) {
    const botCfg = (botConfigs as any)?.[bot] || {};
    const profile = (botCfg as any)?.profile || {};
    const overrideEnvSecrets = readStringRecord((profile as any)?.envSecrets);
    const botEnvSecrets = { ...fleetEnvSecrets, ...overrideEnvSecrets } as Record<string, string>;
    envSecretsByBot[bot] = botEnvSecrets;

    for (const [envVar, secretName] of Object.entries(botEnvSecrets)) {
      secretNamesAll.add(secretName);
      const set = envVarsBySecretName.get(secretName) || new Set<string>();
      set.add(envVar);
      envVarsBySecretName.set(secretName, set);
    }

    const models = collectBotModels({ clawdbot: (botCfg as any)?.clawdbot || {}, hostDefaultModel: hostCfg.agentModelPrimary });
    const modelEnvVars = new Set<string>();
    for (const model of models) {
      for (const envVar of getModelRequiredEnvVars(model)) modelEnvVars.add(envVar);
    }
    const clawdbotEnvVars = new Set<string>(
      collectRequiredEnvVarsFromClawdbot((botCfg as any)?.clawdbot || {}),
    );

    for (const envVar of Array.from(modelEnvVars).sort()) {
      const secretName = botEnvSecrets[envVar];
      if (!secretName) {
        missingEnvSecretMappings.push({ bot, envVar, model: models[0] || String(hostCfg.agentModelPrimary || "").trim() });
        continue;
      }
      secretNamesRequired.add(secretName);
    }

    for (const envVar of Array.from(clawdbotEnvVars).sort()) {
      const secretName = botEnvSecrets[envVar];
      if (!secretName) {
        missingEnvSecretMappings.push({ bot, envVar, model: "clawdbot:discord" });
        continue;
      }
      secretNamesRequired.add(secretName);
    }
  }

  const envVarsBySecretNameObj: Record<string, string[]> = {};
  for (const [secretName, vars] of envVarsBySecretName.entries()) {
    envVarsBySecretNameObj[secretName] = Array.from(vars).sort();
  }

  return {
    bots,
    envSecretsByBot,
    secretNamesAll: Array.from(secretNamesAll).sort(),
    secretNamesRequired: Array.from(secretNamesRequired).sort(),
    envVarsBySecretName: envVarsBySecretNameObj,
    missingEnvSecretMappings,
  };
}
