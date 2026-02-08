import type { SecretsPlanWarning } from "./secrets-plan.js";
import { getKnownLlmProviders, getProviderCredentials } from "@clawlets/shared/lib/llm-provider-env";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";

const ENV_REF_RE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

  const hooks = gatewayCfg.hooks;
  if (isPlainObject(hooks)) {
    const tokenSecret = coerceTrimmedString(hooks.tokenSecret);
    if (tokenSecret) {
      entries.push({
        envVar: HOOKS_TOKEN_ENV_VAR,
        secretName: tokenSecret,
        path: "hooks.tokenSecret",
        help: ENV_VAR_HELP[HOOKS_TOKEN_ENV_VAR],
      });
    }

    const gmailSecret = coerceTrimmedString(hooks.gmailPushTokenSecret);
    if (gmailSecret) {
      entries.push({
        envVar: HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR,
        secretName: gmailSecret,
        path: "hooks.gmailPushTokenSecret",
        help: ENV_VAR_HELP[HOOKS_GMAIL_PUSH_TOKEN_ENV_VAR],
      });
    }
  }

  const skills = gatewayCfg.skills;
  const skillEntries = isPlainObject(skills) ? skills.entries : null;
  if (!isPlainObject(skillEntries)) return entries;

  for (const [skill, entry] of Object.entries(skillEntries)) {
    if (!isPlainObject(entry)) continue;
    const secretName = coerceTrimmedString(entry.apiKeySecret);
    if (!secretName) continue;
    entries.push({
      envVar: skillApiKeyEnvVar(skill),
      secretName,
      path: `skills.entries.${skill}.apiKeySecret`,
      help: `Skill ${skill} API key`,
    });
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

export function collectGatewayModels(params: { openclaw: unknown; hostDefaultModel: string }): string[] {
  const models: string[] = [];

  const hostDefaultModel = String(params.hostDefaultModel || "").trim();
  const defaults = isPlainObject(params.openclaw) && isPlainObject(params.openclaw.agents)
    ? params.openclaw.agents.defaults
    : undefined;

  const pushModel = (value: unknown): void => {
    if (typeof value !== "string") return;
    const model = value.trim();
    if (model) models.push(model);
  };

  const readModelSpec = (spec: unknown): void => {
    if (typeof spec === "string") {
      pushModel(spec);
      return;
    }
    if (!isPlainObject(spec)) return;
    pushModel(spec.primary);
    const fallbacks = spec.fallbacks;
    if (Array.isArray(fallbacks)) {
      for (const fallback of fallbacks) pushModel(fallback);
    }
  };

  readModelSpec(isPlainObject(defaults) ? defaults.model : undefined);
  readModelSpec(isPlainObject(defaults) ? defaults.imageModel : undefined);

  if (models.length === 0 && hostDefaultModel) models.push(hostDefaultModel);
  return Array.from(new Set(models));
}

export function isWhatsAppEnabled(openclaw: unknown): boolean {
  if (!isPlainObject(openclaw)) return false;
  const channels = openclaw.channels;
  if (!isPlainObject(channels)) return false;
  const whatsapp = channels.whatsapp;
  if (!isPlainObject(whatsapp)) return false;
  return whatsapp.enabled !== false;
}

export function buildBaseSecretEnv(params: {
  globalEnv: unknown;
  gatewayEnv: unknown;
  aliasMap: Map<string, string>;
  warnings: SecretsPlanWarning[];
  gateway: string;
}): Record<string, string> {
  const out: Record<string, string> = {};

  const apply = (value: unknown, source: "fleet" | "gateway") => {
    if (!isPlainObject(value)) return;
    for (const [rawKey, rawValue] of Object.entries(value)) {
      if (typeof rawValue !== "string") continue;
      const key = canonicalizeEnvVar(String(rawKey || "").trim(), params.aliasMap);
      const mappedSecretName = rawValue.trim();
      if (!key || !mappedSecretName) continue;
      const existing = out[key];
      if (existing && existing !== mappedSecretName) {
        params.warnings.push({
          kind: "config",
          gateway: params.gateway,
          message: `secretEnv mapping conflict for ${key} (${source} overrides ${existing})`,
        });
      }
      out[key] = mappedSecretName;
    }
  };

  apply(params.globalEnv, "fleet");
  apply(params.gatewayEnv, "gateway");
  return out;
}
