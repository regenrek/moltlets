import type { ClawletsConfig } from "./clawlets-config.js";
import { getAtPath } from "./object-path.js";
import { skillApiKeyEnvVar } from "./fleet-secrets-plan-helpers.js";
import invariantSpec from "../assets/openclaw-invariants.json" with { type: "json" };

const DEFAULT_GATEWAY_PORT_BASE = invariantSpec.defaults.gatewayPortBase;
const DEFAULT_GATEWAY_PORT_STRIDE = invariantSpec.defaults.gatewayPortStride;
const DEFAULT_STATE_DIR_BASE = invariantSpec.defaults.stateDirBase;
const DEFAULT_COMMANDS = { native: "auto", nativeSkills: "auto" };

export type OpenClawInvariantWarning = {
  gateway: string;
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toCleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toCleanNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toCleanBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function normalizeHooks(raw: Record<string, unknown>): Record<string, unknown> {
  const hooks = structuredClone(raw);
  const tokenSecret = toCleanString(hooks["tokenSecret"]);
  if (tokenSecret && hooks["token"] === undefined) {
    hooks["token"] = "${OPENCLAW_HOOKS_TOKEN}";
  }
  delete (hooks as any).tokenSecret;

  const gmailPushTokenSecret = toCleanString(hooks["gmailPushTokenSecret"]);
  if (gmailPushTokenSecret) {
    const gmail = isPlainObject(hooks["gmail"]) ? (hooks["gmail"] as Record<string, unknown>) : {};
    if (gmail["pushToken"] === undefined) {
      gmail["pushToken"] = "${OPENCLAW_HOOKS_GMAIL_PUSH_TOKEN}";
    }
    hooks["gmail"] = gmail;
  }
  delete (hooks as any).gmailPushTokenSecret;

  return hooks;
}

function normalizeSkills(raw: Record<string, unknown>): Record<string, unknown> {
  const skills = structuredClone(raw);
  const entries = isPlainObject(skills["entries"]) ? (skills["entries"] as Record<string, unknown>) : null;
  if (entries) {
    for (const [skill, entryRaw] of Object.entries(entries)) {
      if (!isPlainObject(entryRaw)) continue;
      const entry = entryRaw as Record<string, unknown>;
      const apiKeySecret = toCleanString(entry["apiKeySecret"]);
      if (apiKeySecret && entry["apiKey"] === undefined) {
        entry["apiKey"] = `\${${skillApiKeyEnvVar(skill)}}`;
      }
      delete (entry as any).apiKeySecret;
    }
  }
  return skills;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
      continue;
    }
    out[key] = structuredClone(value);
  }
  return out;
}

function resolveGatewayIndex(config: ClawletsConfig, gatewayId: string): number {
  const gateways = Array.isArray(config.fleet.gatewayOrder) ? config.fleet.gatewayOrder : [];
  const index = gateways.indexOf(gatewayId);
  if (index === -1) throw new Error(`gateway not found in fleet.gatewayOrder: ${gatewayId}`);
  return index;
}

function resolveGatewayPort(params: { config: ClawletsConfig; gatewayId: string; profile: Record<string, unknown> }): number {
  const override = toCleanNumber(params.profile["gatewayPort"]);
  if (override != null) return Math.floor(override);
  const index = resolveGatewayIndex(params.config, params.gatewayId);
  return DEFAULT_GATEWAY_PORT_BASE + index * DEFAULT_GATEWAY_PORT_STRIDE;
}

function resolveWorkspaceDir(params: { gatewayId: string; profile: Record<string, unknown> }): string {
  const workspace = isPlainObject(params.profile["workspace"]) ? (params.profile["workspace"] as Record<string, unknown>) : {};
  const dir = toCleanString(workspace["dir"]);
  if (dir) return dir;
  return `${DEFAULT_STATE_DIR_BASE}/${params.gatewayId}/workspace`;
}

function resolveSkipBootstrap(params: { profile: Record<string, unknown> }): boolean {
  const override = toCleanBoolean(params.profile["skipBootstrap"]);
  if (override != null) return override;
  const workspace = isPlainObject(params.profile["workspace"]) ? (params.profile["workspace"] as Record<string, unknown>) : {};
  const seedDir = workspace["seedDir"];
  return seedDir != null && String(seedDir).trim() !== "";
}

function warnOverrides(params: {
  gateway: string;
  base: Record<string, unknown>;
  path: string[];
  expected: unknown;
}): OpenClawInvariantWarning | null {
  const existing = getAtPath(params.base, params.path);
  if (existing === undefined) return null;
  const pathLabel = params.path.join(".");
  const message = `openclaw.${pathLabel} is managed by clawlets invariants and will be overwritten`;
  return {
    gateway: params.gateway,
    path: pathLabel,
    message,
    expected: params.expected,
    actual: existing,
  };
}

export function buildOpenClawGatewayConfig(params: {
  config: ClawletsConfig;
  gatewayId: string;
}): {
  gatewayId: string;
  base: Record<string, unknown>;
  merged: Record<string, unknown>;
  invariants: Record<string, unknown>;
  warnings: OpenClawInvariantWarning[];
} {
  const gatewayCfg = (params.config.fleet.gateways as Record<string, unknown> | undefined)?.[params.gatewayId];
  const gatewayCfgObj = isPlainObject(gatewayCfg) ? gatewayCfg : {};
  const profile = isPlainObject(gatewayCfgObj["profile"]) ? (gatewayCfgObj["profile"] as Record<string, unknown>) : {};
  const base = isPlainObject(gatewayCfgObj["openclaw"]) ? (gatewayCfgObj["openclaw"] as Record<string, unknown>) : {};
  const typedChannels = isPlainObject(gatewayCfgObj["channels"]) ? (gatewayCfgObj["channels"] as Record<string, unknown>) : {};
  const typedAgents = isPlainObject(gatewayCfgObj["agents"]) ? (gatewayCfgObj["agents"] as Record<string, unknown>) : {};
  const typedHooksRaw = isPlainObject(gatewayCfgObj["hooks"]) ? (gatewayCfgObj["hooks"] as Record<string, unknown>) : {};
  const typedSkillsRaw = isPlainObject(gatewayCfgObj["skills"]) ? (gatewayCfgObj["skills"] as Record<string, unknown>) : {};
  const typedPlugins = isPlainObject(gatewayCfgObj["plugins"]) ? (gatewayCfgObj["plugins"] as Record<string, unknown>) : {};
  const typedHooks = normalizeHooks(typedHooksRaw);
  const typedSkills = normalizeSkills(typedSkillsRaw);
  const baseWithDefaults = deepMerge(
    deepMerge({ commands: DEFAULT_COMMANDS }, base),
    { channels: typedChannels, agents: typedAgents, hooks: typedHooks, skills: typedSkills, plugins: typedPlugins },
  );

  const gatewayPort = resolveGatewayPort({ config: params.config, gatewayId: params.gatewayId, profile });
  const workspaceDir = resolveWorkspaceDir({ gatewayId: params.gatewayId, profile });
  const skipBootstrap = resolveSkipBootstrap({ profile });

  const gatewayDefaults = invariantSpec.gateway;
  const invariants: Record<string, unknown> = {
    gateway: {
      mode: gatewayDefaults.mode,
      bind: gatewayDefaults.bind,
      port: gatewayPort,
      auth: {
        mode: gatewayDefaults.auth.mode,
        token: gatewayDefaults.auth.token,
      },
    },
    agents: {
      defaults: {
        workspace: workspaceDir,
        skipBootstrap,
      },
    },
  };

  const warnings: OpenClawInvariantWarning[] = [];
  const warn = (path: string[], expected: unknown) => {
    const w = warnOverrides({ gateway: params.gatewayId, base, path, expected });
    if (w) warnings.push(w);
  };

  warn(["gateway", "mode"], gatewayDefaults.mode);
  warn(["gateway", "bind"], gatewayDefaults.bind);
  warn(["gateway", "port"], gatewayPort);
  warn(["gateway", "auth"], { mode: gatewayDefaults.auth.mode, token: gatewayDefaults.auth.token });
  warn(["agents", "defaults", "workspace"], workspaceDir);
  warn(["agents", "defaults", "skipBootstrap"], skipBootstrap);

  return {
    gatewayId: params.gatewayId,
    base,
    merged: deepMerge(baseWithDefaults, invariants),
    invariants,
    warnings,
  };
}
