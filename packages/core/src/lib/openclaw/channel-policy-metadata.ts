export type OpenclawRuntimeOp = "login" | "logout";

export type OpenclawChannelTokenFieldSpec = {
  path: readonly string[];
  envVar: string;
};

export type OpenclawChannelUiPolicySpec = {
  allowFromPath?: readonly string[];
  tokenFields?: readonly OpenclawChannelTokenFieldSpec[];
  runtimeOps?: readonly OpenclawRuntimeOp[];
  helpText?: string;
  supportsEnabled?: boolean;
};

export type OpenclawChannelPolicySpec = {
  channelId: string;
  label: string;
  dmPolicyPath?: readonly string[];
  dmAllowFromPath?: readonly string[];
  groupPolicyPath?: readonly string[];
  groupAllowFromPath?: readonly string[];
  ui?: OpenclawChannelUiPolicySpec;
};

const OPENCLAW_CHANNEL_POLICY_SPECS: readonly OpenclawChannelPolicySpec[] = [
  {
    channelId: "telegram",
    label: "Telegram",
    dmPolicyPath: ["channels", "telegram", "dmPolicy"],
    dmAllowFromPath: ["channels", "telegram", "allowFrom"],
    groupPolicyPath: ["channels", "telegram", "groupPolicy"],
    groupAllowFromPath: ["channels", "telegram", "groupAllowFrom"],
    ui: {
      allowFromPath: ["channels", "telegram", "allowFrom"],
      tokenFields: [{ path: ["channels", "telegram", "botToken"], envVar: "TELEGRAM_BOT_TOKEN" }],
    },
  },
  {
    channelId: "whatsapp",
    label: "WhatsApp",
    dmPolicyPath: ["channels", "whatsapp", "dmPolicy"],
    dmAllowFromPath: ["channels", "whatsapp", "allowFrom"],
    groupPolicyPath: ["channels", "whatsapp", "groupPolicy"],
    groupAllowFromPath: ["channels", "whatsapp", "groupAllowFrom"],
    ui: {
      allowFromPath: ["channels", "whatsapp", "allowFrom"],
      runtimeOps: ["login", "logout"],
      supportsEnabled: false,
    },
  },
  {
    channelId: "signal",
    label: "Signal",
    dmPolicyPath: ["channels", "signal", "dmPolicy"],
    dmAllowFromPath: ["channels", "signal", "allowFrom"],
    groupPolicyPath: ["channels", "signal", "groupPolicy"],
    groupAllowFromPath: ["channels", "signal", "groupAllowFrom"],
  },
  {
    channelId: "imessage",
    label: "iMessage",
    dmPolicyPath: ["channels", "imessage", "dmPolicy"],
    dmAllowFromPath: ["channels", "imessage", "allowFrom"],
    groupPolicyPath: ["channels", "imessage", "groupPolicy"],
    groupAllowFromPath: ["channels", "imessage", "groupAllowFrom"],
  },
  {
    channelId: "bluebubbles",
    label: "BlueBubbles",
    dmPolicyPath: ["channels", "bluebubbles", "dmPolicy"],
    dmAllowFromPath: ["channels", "bluebubbles", "allowFrom"],
    groupPolicyPath: ["channels", "bluebubbles", "groupPolicy"],
    groupAllowFromPath: ["channels", "bluebubbles", "groupAllowFrom"],
  },
  {
    channelId: "discord",
    label: "Discord",
    dmPolicyPath: ["channels", "discord", "dm", "policy"],
    dmAllowFromPath: ["channels", "discord", "dm", "allowFrom"],
    groupPolicyPath: ["channels", "discord", "groupPolicy"],
    groupAllowFromPath: ["channels", "discord", "groupAllowFrom"],
    ui: {
      tokenFields: [{ path: ["channels", "discord", "token"], envVar: "DISCORD_BOT_TOKEN" }],
      helpText:
        "Discord allowlists are controlled via channels.discord.groupPolicy and related Discord-specific options.",
    },
  },
  {
    channelId: "slack",
    label: "Slack",
    dmPolicyPath: ["channels", "slack", "dm", "policy"],
    dmAllowFromPath: ["channels", "slack", "dm", "allowFrom"],
    groupPolicyPath: ["channels", "slack", "groupPolicy"],
    groupAllowFromPath: ["channels", "slack", "groupAllowFrom"],
    ui: {
      tokenFields: [
        { path: ["channels", "slack", "botToken"], envVar: "SLACK_BOT_TOKEN" },
        { path: ["channels", "slack", "appToken"], envVar: "SLACK_APP_TOKEN" },
      ],
    },
  },
];

const POLICY_SPECS_BY_CHANNEL = new Map(OPENCLAW_CHANNEL_POLICY_SPECS.map((spec) => [spec.channelId, spec]));

export function listOpenclawChannelPolicySpecs(): readonly OpenclawChannelPolicySpec[] {
  return OPENCLAW_CHANNEL_POLICY_SPECS;
}

export function getOpenclawChannelPolicySpec(channelId: string): OpenclawChannelPolicySpec | null {
  const key = String(channelId || "").trim();
  if (!key) return null;
  return POLICY_SPECS_BY_CHANNEL.get(key) ?? null;
}

export function toDotPath(path: readonly string[]): string {
  return path.join(".");
}
