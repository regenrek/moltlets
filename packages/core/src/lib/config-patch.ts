import { listPinnedChannels } from "./openclaw/channel-registry.js";

export type BotSecurityDefaultsChange = {
  scope: "openclaw" | "channels";
  path: string;
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

function hasSchemaProperty(schema: unknown, key: string): boolean {
  if (!isPlainObject(schema)) return false;
  const props = schema["properties"];
  if (!isPlainObject(props)) return false;
  return Object.prototype.hasOwnProperty.call(props, key);
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isPlainObject(existing)) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function setValue(params: {
  obj: Record<string, unknown>;
  key: string;
  value: unknown;
  pathLabel: string;
  scope: BotSecurityDefaultsChange["scope"];
  changes: BotSecurityDefaultsChange[];
}): void {
  const existing = params.obj[params.key];
  if (existing === params.value) return;
  params.obj[params.key] = params.value;
  params.changes.push({ scope: params.scope, path: params.pathLabel });
}

function isEnabledChannel(channelCfg: unknown): boolean {
  if (!isPlainObject(channelCfg)) return false;
  return channelCfg["enabled"] !== false;
}

export function applySecurityDefaults(params: {
  openclaw: unknown;
  channels?: unknown;
}): {
  openclaw: Record<string, unknown>;
  channels: Record<string, unknown>;
  warnings: string[];
  changes: BotSecurityDefaultsChange[];
} {
  const baseOpenclaw = isPlainObject(params.openclaw) ? params.openclaw : {};
  const openclaw = structuredClone(baseOpenclaw) as Record<string, unknown>;
  const baseChannels = isPlainObject(params.channels) ? params.channels : {};
  const channels = structuredClone(baseChannels) as Record<string, unknown>;
  const warnings: string[] = [];
  const changes: BotSecurityDefaultsChange[] = [];
  const pinnedChannels = listPinnedChannels();
  const channelLabels = new Map(pinnedChannels.map((channel) => [channel.id, channel.name] as const));
  const getLabel = (channelId: string) => channelLabels.get(channelId) ?? titleCase(channelId);

  {
    const logging = ensureObject(openclaw, "logging");
    const redactSensitive = typeof logging["redactSensitive"] === "string" ? String(logging["redactSensitive"]).trim() : "";
    if (!redactSensitive || redactSensitive === "off") {
      setValue({
        obj: logging,
        key: "redactSensitive",
        value: "tools",
        pathLabel: "logging.redactSensitive",
        scope: "openclaw",
        changes,
      });
    }
  }

  {
    const session = ensureObject(openclaw, "session");
    const dmScope = typeof session["dmScope"] === "string" ? String(session["dmScope"]).trim() : "";
    if (!dmScope || dmScope === "main") {
      setValue({
        obj: session,
        key: "dmScope",
        value: "per-channel-peer",
        pathLabel: "session.dmScope",
        scope: "openclaw",
        changes,
      });
    }
  }

  const setDmPolicy = (params: {
    channelId: string;
    policyKey: string;
    allowFromKey: string;
    label: string;
  }) => {
    const cfg = channels[params.channelId];
    if (!isEnabledChannel(cfg)) return;
    const chan = cfg as Record<string, unknown>;
    const policyRaw = typeof chan[params.policyKey] === "string" ? String(chan[params.policyKey]).trim() : "";
    let policyNext = policyRaw;
    if (!policyRaw || policyRaw === "open") {
      policyNext = "pairing";
      setValue({
        obj: chan,
        key: params.policyKey,
        value: policyNext,
        pathLabel: `${params.channelId}.${params.policyKey}`,
        scope: "channels",
        changes,
      });
      if (policyRaw === "open") warnings.push(`${params.label}: changed dmPolicy from "open" to "pairing" (safer default).`);
    } else {
      policyNext = policyRaw;
    }

    const allowFrom = Array.isArray(chan[params.allowFromKey]) ? (chan[params.allowFromKey] as unknown[]) : [];
    const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");
    if (hasWildcard && policyNext !== "open") {
      warnings.push(`${params.label}: allowFrom contains "*" (anyone) while dmPolicy is not "open". Review allowlist.`);
    }
  };

  for (const channel of pinnedChannels) {
    if (!hasSchemaProperty(channel.schema, "dmPolicy") || !hasSchemaProperty(channel.schema, "allowFrom")) continue;
    setDmPolicy({
      channelId: channel.id,
      label: getLabel(channel.id),
      policyKey: "dmPolicy",
      allowFromKey: "allowFrom",
    });
  }

  const setGroupPolicy = (params: { channelId: string; label: string }) => {
    const cfg = channels[params.channelId];
    if (!isEnabledChannel(cfg)) return;
    const chan = cfg as Record<string, unknown>;
    const policyRaw = typeof chan["groupPolicy"] === "string" ? String(chan["groupPolicy"]).trim() : "";
    const allowFrom = Array.isArray(chan["groupAllowFrom"]) ? (chan["groupAllowFrom"] as unknown[]) : [];
    const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");

    if (!policyRaw || policyRaw === "open") {
      setValue({
        obj: chan,
        key: "groupPolicy",
        value: "allowlist",
        pathLabel: `${params.channelId}.groupPolicy`,
        scope: "channels",
        changes,
      });
      if (policyRaw === "open") warnings.push(`${params.label}: changed groupPolicy from "open" to "allowlist" (safer default).`);
    }

    if (hasWildcard) warnings.push(`${params.label}: groupAllowFrom contains "*" (any group member). Review allowlist.`);
  };

  for (const channel of pinnedChannels) {
    if (channel.id === "discord" || channel.id === "slack") continue;
    if (!hasSchemaProperty(channel.schema, "groupPolicy") || !hasSchemaProperty(channel.schema, "groupAllowFrom")) continue;
    setGroupPolicy({ channelId: channel.id, label: getLabel(channel.id) });
  }

  {
    const cfg = channels["discord"];
    if (isEnabledChannel(cfg)) {
      const discord = cfg as Record<string, unknown>;
      setGroupPolicy({ channelId: "discord", label: getLabel("discord") });
      const dm = ensureObject(discord, "dm");
      const policyRaw = typeof dm["policy"] === "string" ? String(dm["policy"]).trim() : "";
      let policyNext = policyRaw;
      if (!policyRaw || policyRaw === "open") {
        policyNext = "pairing";
        setValue({
          obj: dm,
          key: "policy",
          value: policyNext,
          pathLabel: "discord.dm.policy",
          scope: "channels",
          changes,
        });
        if (policyRaw === "open")
          warnings.push(`${getLabel("discord")}: changed dm.policy from "open" to "pairing" (safer default).`);
      } else {
        policyNext = policyRaw;
      }
      const allowFrom = Array.isArray(dm["allowFrom"]) ? (dm["allowFrom"] as unknown[]) : [];
      const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");
      if (hasWildcard && policyNext !== "open")
        warnings.push(`${getLabel("discord")}: dm.allowFrom contains "*" (anyone). Review allowlist.`);
    }
  }

  {
    const cfg = channels["slack"];
    if (isEnabledChannel(cfg)) {
      const slack = cfg as Record<string, unknown>;
      setGroupPolicy({ channelId: "slack", label: getLabel("slack") });
      const dm = ensureObject(slack, "dm");
      const policyRaw = typeof dm["policy"] === "string" ? String(dm["policy"]).trim() : "";
      let policyNext = policyRaw;
      if (!policyRaw || policyRaw === "open") {
        policyNext = "pairing";
        setValue({
          obj: dm,
          key: "policy",
          value: policyNext,
          pathLabel: "slack.dm.policy",
          scope: "channels",
          changes,
        });
        if (policyRaw === "open")
          warnings.push(`${getLabel("slack")}: changed dm.policy from "open" to "pairing" (safer default).`);
      } else {
        policyNext = policyRaw;
      }
      const allowFrom = Array.isArray(dm["allowFrom"]) ? (dm["allowFrom"] as unknown[]) : [];
      const hasWildcard = allowFrom.some((v) => String(v ?? "").trim() === "*");
      if (hasWildcard && policyNext !== "open")
        warnings.push(`${getLabel("slack")}: dm.allowFrom contains "*" (anyone). Review allowlist.`);
    }
  }

  return { openclaw, channels, warnings, changes };
}
