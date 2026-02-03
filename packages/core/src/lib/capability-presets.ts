import { applySecurityDefaults } from "./config-patch.js";
import { getPinnedChannelUiModel } from "./channel-ui-metadata.js";

export type CapabilityPresetKind = "channel" | "model" | "security" | "plugin";

export type EnvVarRef = {
  path: string;
  envVar: string;
};

export type CapabilityPreset = {
  id: string;
  title: string;
  kind: CapabilityPresetKind;
  patch: Record<string, unknown>;
  requiredEnv?: string[];
  envVarRefs?: EnvVarRef[];
  warnings?: string[];
  docsUrl?: string;
};

export type CapabilityPresetApplyResult = {
  channels: Record<string, unknown>;
  openclaw: Record<string, unknown>;
  warnings: string[];
  requiredEnv: string[];
  envVarRefs: EnvVarRef[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function titleCase(value: string): string {
  return value
    .split(/[_-]/g)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function applyMergePatch(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const baseObj = isPlainObject(base) ? base : {};
  const next: Record<string, unknown> = { ...baseObj };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    if (isPlainObject(value)) {
      next[key] = applyMergePatch(baseObj[key], value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cursor: any = obj;
  for (const part of parts) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function ensureObjectAtPath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const parts = path.split(".").filter(Boolean);
  let cursor: Record<string, unknown> = obj;
  for (const part of parts) {
    const next = cursor[part];
    if (!isPlainObject(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[part] = fresh;
      cursor = fresh;
      continue;
    }
    cursor = next;
  }
  return cursor;
}

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  const key = parts.pop()!;
  const parent = ensureObjectAtPath(obj, parts.join("."));
  parent[key] = value;
}

function ensureEnvRef(obj: Record<string, unknown>, envRef: EnvVarRef): void {
  const refValue = `\${${envRef.envVar}}`;
  const current = getAtPath(obj, envRef.path);
  if (current === undefined || current === null || current === "") {
    setAtPath(obj, envRef.path, refValue);
    return;
  }
  if (typeof current !== "string") {
    throw new Error(`${envRef.path} must be a string env ref like ${refValue}`);
  }
  if (current !== refValue) {
    throw new Error(`${envRef.path} already set; remove inline value and use ${refValue}`);
  }
}

const CHANNEL_PRESET_OVERRIDES: Record<string, Partial<CapabilityPreset>> = {
  whatsapp: {
    patch: {
      // WhatsApp doesn't support a simple `enabled` toggle, but we still want the preset to
      // materialize the channel config so security defaults can be applied.
      channels: { whatsapp: {} },
    },
    warnings: ["WhatsApp requires stateful login on the gateway host (clawdbot channels login)."],
  },
};

function buildChannelPresetFromMetadata(channelId: string): CapabilityPreset | null {
  const channel = getPinnedChannelUiModel(channelId);
  if (!channel) return null;

  const patch: Record<string, unknown> = {};
  if (channel.supportsEnabled) {
    setAtPath(patch, `channels.${channelId}.enabled`, true);
  }
  for (const tokenField of channel.tokenFields) {
    setAtPath(patch, tokenField.path, `\${${tokenField.envVar}}`);
  }
  const requiredEnv = Array.from(new Set(channel.tokenFields.map((token) => token.envVar)));
  const envVarRefs = channel.tokenFields.map((token) => ({ path: token.path, envVar: token.envVar }));
  const override = CHANNEL_PRESET_OVERRIDES[channelId];
  const mergedPatch = override?.patch ? (applyMergePatch(patch, override.patch) as Record<string, unknown>) : patch;

  return {
    id: `channel.${channelId}`,
    title: channel.name,
    kind: "channel",
    patch: mergedPatch,
    requiredEnv: requiredEnv.length ? requiredEnv : undefined,
    envVarRefs: envVarRefs.length ? envVarRefs : undefined,
    warnings: override?.warnings,
    docsUrl: channel.docsUrl,
  };
}

export function getChannelCapabilityPreset(channelId: string): CapabilityPreset {
  const normalized = channelId.trim().toLowerCase();
  if (!normalized) {
    throw new Error("invalid channel id");
  }
  const derived = buildChannelPresetFromMetadata(normalized);
  if (derived) return derived;
  return {
    id: `channel.${normalized}`,
    title: titleCase(normalized),
    kind: "channel",
    patch: {
      channels: {
        [normalized]: {
          enabled: true,
        },
      },
    },
  };
}

export function applyCapabilityPreset(params: {
  openclaw: unknown;
  channels: unknown;
  preset: CapabilityPreset;
}): CapabilityPresetApplyResult {
  const base = isPlainObject(params.openclaw) ? params.openclaw : {};
  const baseChannels = isPlainObject(params.channels) ? params.channels : {};
  const envVarRefs = params.preset.envVarRefs ?? [];
  const rootBase: Record<string, unknown> = { openclaw: structuredClone(base), channels: structuredClone(baseChannels) };
  for (const ref of envVarRefs) {
    const current = getAtPath(rootBase, ref.path);
    const refValue = `\${${ref.envVar}}`;
    if (current === undefined || current === null || current === "") continue;
    if (typeof current !== "string") throw new Error(`${ref.path} must be a string env ref like ${refValue}`);
    if (current !== refValue) throw new Error(`${ref.path} already set; remove inline value and use ${refValue}`);
  }
  const patchedRoot = applyMergePatch(structuredClone(rootBase), params.preset.patch) as Record<string, unknown>;
  for (const ref of envVarRefs) ensureEnvRef(patchedRoot, ref);

  const hardened = applySecurityDefaults({ openclaw: patchedRoot["openclaw"], channels: patchedRoot["channels"] });
  return {
    openclaw: hardened.openclaw,
    channels: hardened.channels,
    warnings: [...(params.preset.warnings ?? []), ...hardened.warnings],
    requiredEnv: params.preset.requiredEnv ?? [],
    envVarRefs,
  };
}
