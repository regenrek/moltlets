import type { SecretSource, SecretSpec, SecretsPlanWarning } from "./secrets-plan.js";
import type { SecretFileSpec } from "./secret-wiring.js";
import { getKnownLlmProviders, getProviderCredentials } from "@clawlets/shared/lib/llm-provider-env";

export type SecretSpecAccumulator = {
  name: string;
  kind: SecretSpec["kind"];
  scope: SecretSpec["scope"];
  sources: Set<SecretSource>;
  envVars: Set<string>;
  gateways: Set<string>;
  help?: string;
  optional: boolean;
  fileId?: string;
};

const SOURCE_PRIORITY: SecretSource[] = ["channel", "model", "provider", "custom"];
const ENV_REF_RE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

export const ENV_VAR_HELP: Record<string, string> = {
  DISCORD_BOT_TOKEN: "Discord bot token",
  TELEGRAM_BOT_TOKEN: "Telegram bot token",
  SLACK_BOT_TOKEN: "Slack bot token",
  SLACK_APP_TOKEN: "Slack app token",
  OPENCLAW_HOOKS_TOKEN: "OpenClaw hooks token",
  OPENCLAW_HOOKS_GMAIL_PUSH_TOKEN: "OpenClaw Gmail push token",
  OPENAI_API_KEY: "OpenAI API key",
  ANTHROPIC_API_KEY: "Anthropic API key",
  ANTHROPIC_OAUTH_TOKEN: "Anthropic OAuth token",
  ZAI_API_KEY: "Z.ai API key",
  Z_AI_API_KEY: "Z.ai API key (legacy env)",
  OPENROUTER_API_KEY: "OpenRouter API key",
  XAI_API_KEY: "xAI API key",
  GROQ_API_KEY: "Groq API key",
  DEEPGRAM_API_KEY: "Deepgram API key",
  GEMINI_API_KEY: "Gemini API key",
  MISTRAL_API_KEY: "Mistral API key",
  CEREBRAS_API_KEY: "Cerebras API key",
  MOONSHOT_API_KEY: "Moonshot API key",
  KIMICODE_API_KEY: "Kimi Code API key",
  MINIMAX_API_KEY: "MiniMax API key",
  AI_GATEWAY_API_KEY: "Vercel AI Gateway API key",
  OPENCODE_API_KEY: "OpenCode API key",
  OPENCODE_ZEN_API_KEY: "OpenCode Zen API key",
  CHUTES_API_KEY: "Chutes API key",
  CHUTES_OAUTH_TOKEN: "Chutes OAuth token",
  QWEN_PORTAL_API_KEY: "Qwen portal API key",
  QWEN_OAUTH_TOKEN: "Qwen OAuth token",
  COPILOT_GITHUB_TOKEN: "GitHub Copilot token",
  GH_TOKEN: "GitHub token",
  GITHUB_TOKEN: "GitHub token",
};

const ENV_VAR_SECRET_NAME_SUGGESTIONS: Record<string, (gatewayId?: string) => string> = {
  DISCORD_BOT_TOKEN: (gatewayId) => `discord_token_${gatewayId || "gateway"}`,
  TELEGRAM_BOT_TOKEN: (gatewayId) => `telegram_bot_token_${gatewayId || "gateway"}`,
  SLACK_BOT_TOKEN: (gatewayId) => `slack_bot_token_${gatewayId || "gateway"}`,
  SLACK_APP_TOKEN: (gatewayId) => `slack_app_token_${gatewayId || "gateway"}`,
};

export function suggestSecretNameForEnvVar(envVar: string, gatewayId?: string): string {
  const key = String(envVar || "").trim();
  if (!key) return "";
  const direct = ENV_VAR_SECRET_NAME_SUGGESTIONS[key];
  if (direct) return direct(gatewayId);
  return key.toLowerCase();
}

export function extractEnvVarRef(value: string): string | null {
  const match = value.trim().match(ENV_REF_RE);
  return match ? match[1] || null : null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function collectGatewayModels(params: { openclaw: any; hostDefaultModel: string }): string[] {
  const models: string[] = [];

  const hostDefaultModel = String(params.hostDefaultModel || "").trim();
  const defaults = params.openclaw?.agents?.defaults;

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

export function isWhatsAppEnabled(openclaw: any): boolean {
  const whatsapp = openclaw?.channels?.whatsapp;
  if (!isPlainObject(whatsapp)) return false;
  return (whatsapp as any).enabled !== false;
}

export function buildEnvVarAliasMap(): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const provider of getKnownLlmProviders()) {
    const creds = getProviderCredentials(provider);
    for (const slot of creds) {
      const canonical = slot.anyOfEnv[0];
      if (!canonical) continue;
      for (const envVar of slot.anyOfEnv) {
        const key = envVar.trim();
        if (!key) continue;
        if (!aliasMap.has(key)) aliasMap.set(key, canonical);
      }
    }
  }
  return aliasMap;
}
export function canonicalizeEnvVar(envVar: string, aliasMap: Map<string, string>): string {
  const trimmed = envVar.trim();
  if (!trimmed) return "";
  return aliasMap.get(trimmed) ?? trimmed;
}
export const HOOKS_TOKEN_ENV_VAR = "OPENCLAW_HOOKS_TOKEN";
export const HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR = "OPENCLAW_HOOKS_GMAIL_PUSH_TOKEN";
export function normalizeEnvKey(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/[-./\s]/g, "_").toUpperCase();
}
export function skillApiKeyEnvVar(skill: string): string {
  const key = normalizeEnvKey(skill);
  return key ? `OPENCLAW_SKILL_${key}_API_KEY` : "OPENCLAW_SKILL__API_KEY";
}
export type DerivedSecretEnvEntry = { envVar: string; secretName: string; path: string; help?: string };

export function collectDerivedSecretEnvEntries(gatewayCfg: unknown): DerivedSecretEnvEntry[] {
  const entries: DerivedSecretEnvEntry[] = [];
  if (!isPlainObject(gatewayCfg)) return entries;
  const hooks = (gatewayCfg as any).hooks;
  if (isPlainObject(hooks)) {
    const tokenSecret = String((hooks as any).tokenSecret || "").trim();
    if (tokenSecret) {
      entries.push({
        envVar: HOOKS_TOKEN_ENV_VAR,
        secretName: tokenSecret,
        path: "hooks.tokenSecret",
        help: ENV_VAR_HELP[HOOKS_TOKEN_ENV_VAR],
      });
    }
    const gmailSecret = String((hooks as any).gmailPushTokenSecret || "").trim();
    if (gmailSecret) {
      entries.push({
        envVar: HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR,
        secretName: gmailSecret,
        path: "hooks.gmailPushTokenSecret",
        help: ENV_VAR_HELP[HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR],
      });
    }
  }
  const skills = (gatewayCfg as any).skills;
  const skillEntries = isPlainObject(skills) ? (skills as any).entries : null;
  if (isPlainObject(skillEntries)) {
    for (const [skill, entry] of Object.entries(skillEntries)) {
      if (!isPlainObject(entry)) continue;
      const secretName = String((entry as any).apiKeySecret || "").trim();
      if (!secretName) continue;
      entries.push({
        envVar: skillApiKeyEnvVar(skill),
        secretName,
        path: `skills.entries.${skill}.apiKeySecret`,
        help: `Skill ${skill} API key`,
      });
    }
  }
  return entries;
}

export function buildDerivedSecretEnv(gatewayCfg: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of collectDerivedSecretEnvEntries(gatewayCfg)) {
    if (!entry.envVar || !entry.secretName) continue;
    out[entry.envVar] = entry.secretName;
  }
  return out;
}
type AddRequiredEnv = (envVar: string, source: SecretSource, path?: string) => void;

export function applyChannelEnvRequirements(params: {
  gatewayId: string;
  openclaw: any;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
}): void {
  const { gatewayId, openclaw, warnings, addRequiredEnv } = params;
  const addChannelToken = (payload: { channel: string; envVar: string; path: string; value: unknown }) => {
    if (typeof payload.value !== "string") return;
    const trimmed = payload.value.trim();
    if (!trimmed) return;
    const envVar = extractEnvVarRef(trimmed);
    if (envVar && envVar !== payload.envVar) {
      warnings.push({
        kind: "inlineToken",
        channel: payload.channel,
        gateway: gatewayId,
        path: payload.path,
        message: `Unexpected env ref at ${payload.path}: ${trimmed}`,
        suggestion: `Use \${${payload.envVar}} for ${payload.channel} and map it in fleet.secretEnv or hosts.<host>.bots.${gatewayId}.profile.secretEnv.`,
      });
    }
    if (!envVar) {
      warnings.push({
        kind: "inlineToken",
        channel: payload.channel,
        gateway: gatewayId,
        path: payload.path,
        message: `Inline ${payload.channel} token detected at ${payload.path}`,
        suggestion: `Replace with \${${payload.envVar}} and map it in fleet.secretEnv or hosts.<host>.bots.${gatewayId}.profile.secretEnv.`,
      });
    }
    addRequiredEnv(payload.envVar, "channel", payload.path);
  };

  const channels = (openclaw as any)?.channels;
  if (!isPlainObject(channels)) return;

  const discord = channels.discord;
  if (isPlainObject(discord) && (discord as any).enabled !== false) {
    addChannelToken({ channel: "discord", envVar: "DISCORD_BOT_TOKEN", path: "channels.discord.token", value: (discord as any).token });
    const accounts = (discord as any).accounts;
    if (isPlainObject(accounts)) {
      for (const [accountId, accountCfg] of Object.entries(accounts)) {
        if (!isPlainObject(accountCfg)) continue;
        addChannelToken({
          channel: "discord",
          envVar: "DISCORD_BOT_TOKEN",
          path: `channels.discord.accounts.${accountId}.token`,
          value: (accountCfg as any).token,
        });
      }
    }
  }

  const telegram = channels.telegram;
  if (isPlainObject(telegram) && (telegram as any).enabled !== false) {
    addChannelToken({ channel: "telegram", envVar: "TELEGRAM_BOT_TOKEN", path: "channels.telegram.botToken", value: (telegram as any).botToken });
    const accounts = (telegram as any).accounts;
    if (isPlainObject(accounts)) {
      for (const [accountId, accountCfg] of Object.entries(accounts)) {
        if (!isPlainObject(accountCfg)) continue;
        addChannelToken({
          channel: "telegram",
          envVar: "TELEGRAM_BOT_TOKEN",
          path: `channels.telegram.accounts.${accountId}.botToken`,
          value: (accountCfg as any).botToken,
        });
      }
    }
  }

  const slack = channels.slack;
  if (isPlainObject(slack) && (slack as any).enabled !== false) {
    addChannelToken({ channel: "slack", envVar: "SLACK_BOT_TOKEN", path: "channels.slack.botToken", value: (slack as any).botToken });
    addChannelToken({ channel: "slack", envVar: "SLACK_APP_TOKEN", path: "channels.slack.appToken", value: (slack as any).appToken });
    const accounts = (slack as any).accounts;
    if (isPlainObject(accounts)) {
      for (const [accountId, accountCfg] of Object.entries(accounts)) {
        if (!isPlainObject(accountCfg)) continue;
        addChannelToken({
          channel: "slack",
          envVar: "SLACK_BOT_TOKEN",
          path: `channels.slack.accounts.${accountId}.botToken`,
          value: (accountCfg as any).botToken,
        });
        addChannelToken({
          channel: "slack",
          envVar: "SLACK_APP_TOKEN",
          path: `channels.slack.accounts.${accountId}.appToken`,
          value: (accountCfg as any).appToken,
        });
      }
    }
  }
}

export function applyHookEnvRequirements(params: {
  gatewayId: string;
  openclaw: any;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
}): void {
  const { gatewayId, openclaw, warnings, addRequiredEnv } = params;
  const addHookToken = (payload: { envVar: string; path: string; value: unknown; label: string }) => {
    if (typeof payload.value !== "string") return;
    const trimmed = payload.value.trim();
    if (!trimmed) return;
    const envVar = extractEnvVarRef(trimmed);
    if (envVar && envVar !== payload.envVar) {
      warnings.push({
        kind: "inlineToken",
        channel: "hooks",
        gateway: gatewayId,
        path: payload.path,
        message: `Unexpected env ref at ${payload.path}: ${trimmed}`,
        suggestion: `Use \${${payload.envVar}} for ${payload.label} and map it in fleet.secretEnv or hosts.<host>.bots.${gatewayId}.profile.secretEnv.`,
      });
    }
    if (!envVar) {
      warnings.push({
        kind: "inlineToken",
        channel: "hooks",
        gateway: gatewayId,
        path: payload.path,
        message: `Inline hooks token detected at ${payload.path}`,
        suggestion: `Replace with \${${payload.envVar}} and map it in fleet.secretEnv or hosts.<host>.bots.${gatewayId}.profile.secretEnv.`,
      });
    }
    addRequiredEnv(payload.envVar, "custom", payload.path);
  };

  const hooks = (openclaw as any)?.hooks;
  if (!isPlainObject(hooks)) return;
  addHookToken({
    envVar: HOOKS_TOKEN_ENV_VAR,
    path: "hooks.token",
    value: (hooks as any).token,
    label: "hooks.token",
  });
  const gmail = (hooks as any).gmail;
  if (isPlainObject(gmail)) {
    addHookToken({
      envVar: HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR,
      path: "hooks.gmail.pushToken",
      value: (gmail as any).pushToken,
      label: "hooks.gmail.pushToken",
    });
  }
}

export function applySkillEnvRequirements(params: {
  gatewayId: string;
  openclaw: any;
  warnings: SecretsPlanWarning[];
  addRequiredEnv: AddRequiredEnv;
  envVarHelpOverrides: Map<string, string>;
}): void {
  const { gatewayId, openclaw, warnings, addRequiredEnv, envVarHelpOverrides } = params;
  const addSkillApiKey = (payload: { skill: string; path: string; value: unknown }) => {
    if (typeof payload.value !== "string") return;
    const trimmed = payload.value.trim();
    if (!trimmed) return;
    const expectedEnvVar = skillApiKeyEnvVar(payload.skill);
    if (!envVarHelpOverrides.has(expectedEnvVar)) {
      envVarHelpOverrides.set(expectedEnvVar, `Skill ${payload.skill} API key`);
    }
    const envVar = extractEnvVarRef(trimmed);
    if (envVar && envVar !== expectedEnvVar) {
      warnings.push({
        kind: "inlineApiKey",
        gateway: gatewayId,
        path: payload.path,
        message: `Unexpected env ref at ${payload.path}: ${trimmed}`,
        suggestion: `Use \${${expectedEnvVar}} and map it in fleet.secretEnv or hosts.<host>.bots.${gatewayId}.profile.secretEnv.`,
      });
    }
    if (!envVar) {
      warnings.push({
        kind: "inlineApiKey",
        gateway: gatewayId,
        path: payload.path,
        message: `Inline API key detected at ${payload.path}`,
        suggestion: `Replace with \${${expectedEnvVar}} and map it in fleet.secretEnv or hosts.<host>.bots.${gatewayId}.profile.secretEnv.`,
      });
    }
    addRequiredEnv(expectedEnvVar, "custom", payload.path);
  };

  const skills = (openclaw as any)?.skills;
  const skillEntries = isPlainObject(skills) ? (skills as any).entries : null;
  if (!isPlainObject(skillEntries)) return;
  for (const [skill, entry] of Object.entries(skillEntries)) {
    if (!isPlainObject(entry)) continue;
    addSkillApiKey({
      skill,
      path: `skills.entries.${skill}.apiKey`,
      value: (entry as any).apiKey,
    });
  }
}

export function buildBaseSecretEnv(params: {
  globalEnv: unknown;
  gatewayEnv: unknown;
  aliasMap: Map<string, string>;
  warnings: SecretsPlanWarning[];
  gateway: string;
}): Record<string, string> {
  const out: Record<string, string> = {};

  const apply = (v: unknown, source: "fleet" | "gateway") => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
      if (typeof vv !== "string") continue;
      const rawKey = String(k || "").trim();
      const value = vv.trim();
      if (!rawKey || !value) continue;
      const key = canonicalizeEnvVar(rawKey, params.aliasMap);
      if (!key) continue;
      const existing = out[key];
      if (existing && existing !== value) {
        params.warnings.push({
          kind: "config",
          gateway: params.gateway,
          message: `secretEnv mapping conflict for ${key} (${source} overrides ${existing})`,
        });
      }
      out[key] = value;
    }
  };

  apply(params.globalEnv, "fleet");
  apply(params.gatewayEnv, "gateway");
  return out;
}

export function pickPrimarySource(sources: Set<SecretSource>): SecretSource {
  for (const source of SOURCE_PRIORITY) {
    if (sources.has(source)) return source;
  }
  return "custom";
}

export function recordSecretSpec(
  map: Map<string, SecretSpecAccumulator>,
  params: {
    name: string;
    kind: SecretSpec["kind"];
    scope: SecretSpec["scope"];
    source: SecretSource;
    optional: boolean;
    envVar?: string;
    gateway?: string;
    help?: string;
    fileId?: string;
  },
): void {
  const key = params.name;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      name: params.name,
      kind: params.kind,
      scope: params.scope,
      sources: new Set([params.source]),
      envVars: new Set(params.envVar ? [params.envVar] : []),
      gateways: new Set(params.gateway ? [params.gateway] : []),
      help: params.help,
      optional: params.optional,
      fileId: params.fileId,
    });
    return;
  }

  existing.sources.add(params.source);
  if (params.envVar) existing.envVars.add(params.envVar);
  if (params.gateway) existing.gateways.add(params.gateway);
  if (params.help && !existing.help) existing.help = params.help;
  if (!params.optional) existing.optional = false;
  if (existing.scope !== params.scope) {
    existing.scope = existing.scope === "host" || params.scope === "host" ? "host" : "gateway";
  }
  if (!existing.fileId && params.fileId) existing.fileId = params.fileId;
}

export function normalizeSecretFiles(value: unknown): Record<string, SecretFileSpec> {
  if (!isPlainObject(value)) return {};
  return value as Record<string, SecretFileSpec>;
}

export function normalizeEnvVarPaths(pathsByVar: Record<string, string[]>): void {
  for (const [envVar, paths] of Object.entries(pathsByVar)) {
    if (!paths || paths.length === 0) continue;
    pathsByVar[envVar] = Array.from(new Set(paths)).sort();
  }
}
