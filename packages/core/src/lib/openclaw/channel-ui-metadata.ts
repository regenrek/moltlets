import { getOpenclawChannelPolicySpec, toDotPath } from "./channel-policy-metadata.js";
import { listPinnedChannels } from "./channel-registry.js";

export type ChannelTokenField = {
  path: string;
  envVar: string;
};

export type ChannelUiModel = {
  id: string;
  name: string;
  category?: "core" | "plugin";
  docsUrl?: string;
  summary?: string;
  helpText?: string;
  supportsEnabled: boolean;
  enabledPath?: string;
  allowFrom: boolean;
  allowFromPath?: string;
  tokenFields: ChannelTokenField[];
  runtimeOps: Array<"login" | "logout">;
};

function buildChannelPath(channelId: string, field: string): string {
  return `channels.${channelId}.${field}`;
}

function toTokenFields(tokenFields: ReadonlyArray<{ path: readonly string[]; envVar: string }>): ChannelTokenField[] {
  return tokenFields.map((tokenField) => ({ path: toDotPath(tokenField.path), envVar: tokenField.envVar }));
}

export function listPinnedChannelUiModels(): ChannelUiModel[] {
  return listPinnedChannels().map((channel) => {
    const policy = getOpenclawChannelPolicySpec(channel.id);
    const ui = policy?.ui;
    const supportsEnabled = ui?.supportsEnabled ?? true;
    const allowFromPath = ui?.allowFromPath ? toDotPath(ui.allowFromPath) : undefined;

    return {
      id: channel.id,
      name: channel.name,
      category: channel.category,
      docsUrl: channel.docsUrl,
      summary: channel.summary,
      helpText: ui?.helpText ?? channel.summary,
      supportsEnabled,
      enabledPath: supportsEnabled ? buildChannelPath(channel.id, "enabled") : undefined,
      allowFrom: Boolean(allowFromPath),
      allowFromPath,
      tokenFields: ui?.tokenFields ? toTokenFields(ui.tokenFields) : [],
      runtimeOps: ui?.runtimeOps ? [...ui.runtimeOps] : [],
    };
  });
}

export function getPinnedChannelUiModel(channelId: string): ChannelUiModel | null {
  const list = listPinnedChannelUiModels();
  return list.find((entry) => entry.id === channelId) ?? null;
}
