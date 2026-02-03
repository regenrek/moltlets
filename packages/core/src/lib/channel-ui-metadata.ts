import { listPinnedChannels } from "./channel-registry.js"

export type ChannelTokenField = {
  path: string
  envVar: string
}

export type ChannelUiModel = {
  id: string
  name: string
  category?: "core" | "plugin"
  docsUrl?: string
  summary?: string
  helpText?: string
  supportsEnabled: boolean
  enabledPath?: string
  allowFrom: boolean
  allowFromPath?: string
  tokenFields: ChannelTokenField[]
  runtimeOps: Array<"login" | "logout">
}

type ChannelUiOverride = Partial<
  Pick<ChannelUiModel, "allowFrom" | "runtimeOps" | "tokenFields" | "helpText" | "supportsEnabled">
>

const CHANNEL_UI_OVERRIDES: Record<string, ChannelUiOverride> = {
  telegram: {
    allowFrom: true,
    tokenFields: [{ path: "channels.telegram.botToken", envVar: "TELEGRAM_BOT_TOKEN" }],
  },
  discord: {
    helpText:
      "Discord allowlists are controlled via channels.discord.groupPolicy and related Discord-specific options.",
    tokenFields: [{ path: "channels.discord.token", envVar: "DISCORD_BOT_TOKEN" }],
  },
  slack: {
    tokenFields: [
      { path: "channels.slack.botToken", envVar: "SLACK_BOT_TOKEN" },
      { path: "channels.slack.appToken", envVar: "SLACK_APP_TOKEN" },
    ],
  },
  whatsapp: {
    allowFrom: true,
    runtimeOps: ["login", "logout"],
    // WhatsApp doesn't expose a single `channels.whatsapp.enabled` toggle (accounts + linking instead).
    supportsEnabled: false,
  },
}

function buildChannelPath(channelId: string, field: string): string {
  return `channels.${channelId}.${field}`
}

export function listPinnedChannelUiModels(): ChannelUiModel[] {
  return listPinnedChannels().map((channel) => {
    const override = CHANNEL_UI_OVERRIDES[channel.id] ?? {}
    const supportsEnabled = override.supportsEnabled ?? true
    const allowFromSupported = Boolean(override.allowFrom)
    const enabledPath = supportsEnabled ? buildChannelPath(channel.id, "enabled") : undefined
    const allowFromPath = allowFromSupported ? buildChannelPath(channel.id, "allowFrom") : undefined
    return {
      id: channel.id,
      name: channel.name,
      category: channel.category,
      docsUrl: channel.docsUrl,
      summary: channel.summary,
      helpText: override.helpText ?? channel.summary,
      supportsEnabled,
      enabledPath,
      allowFrom: allowFromSupported,
      allowFromPath,
      tokenFields: override.tokenFields ?? [],
      runtimeOps: override.runtimeOps ?? [],
    }
  })
}

export function getPinnedChannelUiModel(channelId: string): ChannelUiModel | null {
  const list = listPinnedChannelUiModels()
  return list.find((entry) => entry.id === channelId) ?? null
}
