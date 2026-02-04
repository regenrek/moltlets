import { getProviderRequiredEnvVars } from "@clawlets/shared/lib/llm-provider-env";
import { DEFAULT_NIX_SUBSTITUTERS, DEFAULT_NIX_TRUSTED_PUBLIC_KEYS } from "./nix-cache.js";
import { assertSafeRecordKey, createNullProtoRecord } from "./safe-record.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return createNullProtoRecord<string>();
  const out = createNullProtoRecord<string>();
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") continue;
    const key = String(k || "").trim();
    const vv = v.trim();
    if (!key || !vv) continue;
    assertSafeRecordKey({ key, context: "migrate string record" });
    out[key] = vv;
  }
  return out;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isPlainObject(existing)) return existing;
  assertSafeRecordKey({ key, context: "migrate ensureObject" });
  const next = createNullProtoRecord<unknown>();
  parent[key] = next;
  return next;
}

function mergeLegacyIntoExisting(params: {
  existing: Record<string, unknown>;
  legacy: Record<string, unknown>;
  context: string;
}): boolean {
  let changed = false;
  for (const [key, legacyValue] of Object.entries(params.legacy)) {
    assertSafeRecordKey({ key, context: params.context });
    const existingValue = params.existing[key];
    if (existingValue === undefined) {
      params.existing[key] = legacyValue;
      changed = true;
      continue;
    }
    if (isPlainObject(existingValue) && isPlainObject(legacyValue)) {
      if (mergeLegacyIntoExisting({ existing: existingValue, legacy: legacyValue, context: params.context })) changed = true;
    }
  }
  return changed;
}

function ensureStringRecord(parent: Record<string, unknown>, key: string): Record<string, string> {
  const existing = parent[key];
  assertSafeRecordKey({ key, context: "migrate ensureStringRecord" });
  if (isPlainObject(existing)) {
    const sanitized = toStringRecord(existing);
    parent[key] = sanitized;
    return sanitized;
  }
  const next = createNullProtoRecord<string>();
  parent[key] = next;
  return next;
}

function applyProviderSecretsToEnv(params: { env: Record<string, string>; providerSecrets: Record<string, string> }): boolean {
  let changed = false;
  for (const [provider, secretName] of Object.entries(params.providerSecrets)) {
    const envVars = getProviderRequiredEnvVars(provider);
    for (const envVar of envVars) {
      if (!params.env[envVar]) {
        params.env[envVar] = secretName;
        changed = true;
      }
    }
  }
  return changed;
}

function ensureDiscordTokenEnvRef(botCfg: Record<string, unknown>): boolean {
  const clawdbot = botCfg["clawdbot"];
  if (!isPlainObject(clawdbot)) return false;
  const channels = clawdbot["channels"];
  if (!isPlainObject(channels)) return false;
  const discord = channels["discord"];
  if (!isPlainObject(discord)) return false;

  const enabled = discord["enabled"];
  if (enabled === false) return false;

  const token = discord["token"];
  if (typeof token === "string" && token.trim()) return false;

  discord["token"] = "${DISCORD_BOT_TOKEN}";
  return true;
}

export type MigrateToV9Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV10Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV11Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV12Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV13Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV14Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV15Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV16Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV17Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export type MigrateToV18Result = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: unknown;
};

export function migrateClawletsConfigToV9(raw: unknown): MigrateToV9Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 9) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 8) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 8)`);

  let changed = false;
  next["schemaVersion"] = 9;
  changed = true;

  const fleet = ensureObject(next, "fleet");

  const fleetSecretEnv = ensureStringRecord(fleet, "secretEnv");
  const fleetSecretFiles = ensureObject(fleet, "secretFiles");
  void fleetSecretFiles;

  if ("guildId" in fleet) {
    delete (fleet as any).guildId;
    changed = true;
  }

  if ("envSecrets" in fleet) {
    const legacy = toStringRecord((fleet as any).envSecrets);
    for (const [envVar, secretName] of Object.entries(legacy)) {
      if (!fleetSecretEnv[envVar]) fleetSecretEnv[envVar] = secretName;
    }
    delete (fleet as any).envSecrets;
    changed = true;
  }

  if ("modelSecrets" in fleet) {
    const legacy = toStringRecord((fleet as any).modelSecrets);
    if (applyProviderSecretsToEnv({ env: fleetSecretEnv, providerSecrets: legacy })) changed = true;
    delete (fleet as any).modelSecrets;
    changed = true;
  }

  const bots = ensureObject(fleet, "bots");
  for (const [botId, botCfgRaw] of Object.entries(bots)) {
    if (!isPlainObject(botCfgRaw)) continue;
    const botCfg = botCfgRaw as Record<string, unknown>;
    const profile = ensureObject(botCfg, "profile");
    const profileSecretEnv = ensureStringRecord(profile, "secretEnv");
    const profileSecretFiles = ensureObject(profile, "secretFiles");
    void profileSecretFiles;

    if ("envSecrets" in profile) {
      const legacy = toStringRecord((profile as any).envSecrets);
      for (const [envVar, secretName] of Object.entries(legacy)) {
        if (!profileSecretEnv[envVar]) profileSecretEnv[envVar] = secretName;
      }
      delete (profile as any).envSecrets;
      changed = true;
    }

    const discordTokenSecret = typeof (profile as any).discordTokenSecret === "string" ? String((profile as any).discordTokenSecret).trim() : "";
    if (discordTokenSecret) {
      if (!profileSecretEnv["DISCORD_BOT_TOKEN"]) profileSecretEnv["DISCORD_BOT_TOKEN"] = discordTokenSecret;
      else if (profileSecretEnv["DISCORD_BOT_TOKEN"] !== discordTokenSecret) {
        warnings.push(`gateway ${botId}: discordTokenSecret differs from profile.secretEnv.DISCORD_BOT_TOKEN; keeping secretEnv`);
      }
      delete (profile as any).discordTokenSecret;
      changed = true;

      if (ensureDiscordTokenEnvRef(botCfg)) changed = true;
    }

    if ("modelSecrets" in profile) {
      const legacy = toStringRecord((profile as any).modelSecrets);
      if (applyProviderSecretsToEnv({ env: profileSecretEnv, providerSecrets: legacy })) changed = true;
      delete (profile as any).modelSecrets;
      changed = true;
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

export function migrateClawletsConfigToV10(raw: unknown): MigrateToV10Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  let next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 10) return { ok: true, changed: false, warnings, migrated: next };

  let changed = false;
  if (schemaVersion === 8) {
    const res = migrateClawletsConfigToV9(next);
    warnings.push(...res.warnings);
    next = structuredClone(res.migrated) as Record<string, unknown>;
    changed = res.changed;
  } else if (schemaVersion !== 9) {
    throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 8 or 9)`);
  }

  if (Number(next["schemaVersion"] ?? 0) === 10) {
    return { ok: true, changed, warnings, migrated: next };
  }

  next["schemaVersion"] = 10;
  changed = true;

  const fleet = ensureObject(next, "fleet");
  const fleetAuthorized = new Set(toStringArray((fleet as any).sshAuthorizedKeys));
  const fleetKnown = new Set(toStringArray((fleet as any).sshKnownHosts));
  (fleet as any).sshAuthorizedKeys = Array.from(fleetAuthorized);
  (fleet as any).sshKnownHosts = Array.from(fleetKnown);

  const hosts = (next as any).hosts;
  if (isPlainObject(hosts)) {
    for (const [host, hostCfg] of Object.entries(hosts)) {
      if (!isPlainObject(hostCfg)) continue;
      const hostKeys = toStringArray((hostCfg as any).sshAuthorizedKeys);
      const hostKnown = toStringArray((hostCfg as any).sshKnownHosts);
      if (hostKeys.length || hostKnown.length) {
        for (const key of hostKeys) fleetAuthorized.add(key);
        for (const entry of hostKnown) fleetKnown.add(entry);
        warnings.push(`host ${host}: moved sshAuthorizedKeys/sshKnownHosts to fleet scope`);
        delete (hostCfg as any).sshAuthorizedKeys;
        delete (hostCfg as any).sshKnownHosts;
        changed = true;
      }
    }
  }

  (fleet as any).sshAuthorizedKeys = Array.from(fleetAuthorized);
  (fleet as any).sshKnownHosts = Array.from(fleetKnown);

  return { ok: true, changed, warnings, migrated: next };
}

function migrateHostCacheToV11(params: {
  host: string;
  hostCfg: Record<string, unknown>;
  warnings: string[];
}): boolean {
  const cache = params.hostCfg["cache"];
  if (!isPlainObject(cache)) return false;
  const garnix = cache["garnix"];
  if (!isPlainObject(garnix)) return false;
  const priv = garnix["private"];
  if (!isPlainObject(priv)) return false;

  const enable = Boolean(priv["enable"]);
  const netrcSecret = typeof priv["netrcSecret"] === "string" ? String(priv["netrcSecret"]).trim() : "";
  const netrcPath = typeof priv["netrcPath"] === "string" ? String(priv["netrcPath"]).trim() : "";
  const ttl = typeof priv["narinfoCachePositiveTtl"] === "number" ? Number(priv["narinfoCachePositiveTtl"]) : 3600;

  params.hostCfg["cache"] = {
    substituters: Array.from(DEFAULT_NIX_SUBSTITUTERS),
    trustedPublicKeys: Array.from(DEFAULT_NIX_TRUSTED_PUBLIC_KEYS),
    netrc: {
      enable,
      secretName: netrcSecret || "garnix_netrc",
      path: netrcPath || "/etc/nix/netrc",
      narinfoCachePositiveTtl: Number.isInteger(ttl) && ttl > 0 ? ttl : 3600,
    },
  };

  params.warnings.push(`host ${params.host}: migrated cache.garnix.private.* -> cache.{substituters,trustedPublicKeys,netrc.*}`);
  return true;
}

function migrateHostSelfUpdateToV11(params: {
  host: string;
  hostCfg: Record<string, unknown>;
  warnings: string[];
}): boolean {
  const selfUpdate = params.hostCfg["selfUpdate"];
  if (!isPlainObject(selfUpdate)) return false;

  const legacyManifestUrl = typeof selfUpdate["manifestUrl"] === "string" ? String(selfUpdate["manifestUrl"]).trim() : "";
  const legacyPublicKey = typeof selfUpdate["publicKey"] === "string" ? String(selfUpdate["publicKey"]).trim() : "";

  const isLegacy = "manifestUrl" in selfUpdate || "publicKey" in selfUpdate || "signatureUrl" in selfUpdate;
  if (!isLegacy) return false;

  const enable = Boolean(selfUpdate["enable"]);
  const interval = typeof selfUpdate["interval"] === "string" ? String(selfUpdate["interval"]).trim() : "";

  params.hostCfg["selfUpdate"] = {
    enable,
    interval: interval || "30min",
    baseUrl: legacyManifestUrl,
    channel: "prod",
    publicKeys: legacyPublicKey ? [legacyPublicKey] : [],
    allowUnsigned: false,
    allowRollback: false,
    healthCheckUnit: "",
  };

  params.warnings.push(`host ${params.host}: migrated selfUpdate.manifestUrl/publicKey -> selfUpdate.baseUrl/publicKeys`);
  return true;
}

export function migrateClawletsConfigToV11(raw: unknown): MigrateToV11Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  let next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 11) return { ok: true, changed: false, warnings, migrated: next };

  let changed = false;
  if (schemaVersion === 8 || schemaVersion === 9) {
    const res = migrateClawletsConfigToV10(next);
    warnings.push(...res.warnings);
    next = structuredClone(res.migrated) as Record<string, unknown>;
    changed = res.changed;
  } else if (schemaVersion !== 10) {
    throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 8, 9, or 10)`);
  }

  if (Number(next["schemaVersion"] ?? 0) === 11) return { ok: true, changed, warnings, migrated: next };
  if (Number(next["schemaVersion"] ?? 0) !== 10) {
    throw new Error(`internal error: expected schemaVersion 10 before v11 migration`);
  }

  next["schemaVersion"] = 11;
  changed = true;

  const hosts = next["hosts"];
  if (isPlainObject(hosts)) {
    for (const [host, hostCfgRaw] of Object.entries(hosts)) {
      if (!isPlainObject(hostCfgRaw)) continue;
      const hostCfg = hostCfgRaw as Record<string, unknown>;
      if (migrateHostCacheToV11({ host, hostCfg, warnings })) changed = true;
      if (migrateHostSelfUpdateToV11({ host, hostCfg, warnings })) changed = true;
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

function migrateHostSelfUpdateToV12(params: {
  host: string;
  hostCfg: Record<string, unknown>;
  warnings: string[];
}): boolean {
  const selfUpdate = params.hostCfg["selfUpdate"];
  if (!isPlainObject(selfUpdate)) return false;

  const baseUrl = typeof selfUpdate["baseUrl"] === "string" ? String(selfUpdate["baseUrl"]).trim() : "";
  const baseUrls = toStringArray(selfUpdate["baseUrls"]);

  const hasLegacy = "baseUrl" in selfUpdate;
  const hasNext = "baseUrls" in selfUpdate;
  if (!hasLegacy && !hasNext) return false;

  if (baseUrls.length > 0) {
    selfUpdate["baseUrls"] = baseUrls;
  } else if (baseUrl) {
    selfUpdate["baseUrls"] = [baseUrl];
  } else {
    selfUpdate["baseUrls"] = [];
  }

  if ("baseUrl" in selfUpdate) delete (selfUpdate as any).baseUrl;

  params.warnings.push(`host ${params.host}: migrated selfUpdate.baseUrl -> selfUpdate.baseUrls`);
  return true;
}

export function migrateClawletsConfigToV12(raw: unknown): MigrateToV12Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  let next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 12) return { ok: true, changed: false, warnings, migrated: next };

  let changed = false;
  if (schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10) {
    const res = migrateClawletsConfigToV11(next);
    warnings.push(...res.warnings);
    next = structuredClone(res.migrated) as Record<string, unknown>;
    changed = res.changed;
  } else if (schemaVersion !== 11) {
    throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 8, 9, 10, or 11)`);
  }

  if (Number(next["schemaVersion"] ?? 0) === 12) return { ok: true, changed, warnings, migrated: next };
  if (Number(next["schemaVersion"] ?? 0) !== 11) {
    throw new Error(`internal error: expected schemaVersion 11 before v12 migration`);
  }

  next["schemaVersion"] = 12;
  changed = true;

  const hosts = next["hosts"];
  if (isPlainObject(hosts)) {
    for (const [host, hostCfgRaw] of Object.entries(hosts)) {
      if (!isPlainObject(hostCfgRaw)) continue;
      const hostCfg = hostCfgRaw as Record<string, unknown>;
      if (migrateHostSelfUpdateToV12({ host, hostCfg, warnings })) changed = true;
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

export function migrateClawletsConfigToV13(raw: unknown): MigrateToV13Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 13) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 12) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 12)`);

  let changed = false;
  next["schemaVersion"] = 13;
  changed = true;

  const fleet = next["fleet"];
  if (isPlainObject(fleet)) {
    const bots = fleet["bots"];
    if (isPlainObject(bots)) {
      for (const [botId, botCfgRaw] of Object.entries(bots)) {
        if (!isPlainObject(botCfgRaw)) continue;
        const botCfg = botCfgRaw as Record<string, unknown>;

        const moveLegacySurface = (params: { sourceLabel: string; source: Record<string, unknown>; key: string }) => {
          if (!(params.key in params.source)) return;
          const legacyValue = params.source[params.key];
          delete params.source[params.key];
          changed = true;

          if (!isPlainObject(legacyValue) || Object.keys(legacyValue).length === 0) {
            if (legacyValue !== undefined) warnings.push(`gateway ${botId}: dropped ${params.sourceLabel}.${params.key} (expected object)`);
            return;
          }

          const dest = ensureObject(botCfg, params.key);
          const merged = mergeLegacyIntoExisting({
            existing: dest,
            legacy: legacyValue,
            context: `migrate ${params.sourceLabel}.${params.key}`,
          });
          if (merged) changed = true;
          warnings.push(`gateway ${botId}: moved ${params.sourceLabel}.${params.key} -> ${params.key}`);
        };

        const profile = botCfg["profile"];
        if (isPlainObject(profile)) {
          moveLegacySurface({ sourceLabel: "profile", source: profile, key: "hooks" });
          moveLegacySurface({ sourceLabel: "profile", source: profile, key: "skills" });
        }

        const clawdbot = botCfg["clawdbot"];
        if (isPlainObject(clawdbot)) {
          moveLegacySurface({ sourceLabel: "clawdbot", source: clawdbot, key: "channels" });
          moveLegacySurface({ sourceLabel: "clawdbot", source: clawdbot, key: "agents" });
          moveLegacySurface({ sourceLabel: "clawdbot", source: clawdbot, key: "hooks" });
          moveLegacySurface({ sourceLabel: "clawdbot", source: clawdbot, key: "skills" });
          moveLegacySurface({ sourceLabel: "clawdbot", source: clawdbot, key: "plugins" });
        }
      }
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

export function migrateClawletsConfigToV14(raw: unknown): MigrateToV14Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 14) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 13) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 13)`);

  next["schemaVersion"] = 14;
  return { ok: true, changed: true, warnings, migrated: next };
}

export function migrateClawletsConfigToV15(raw: unknown): MigrateToV15Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 15) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 14) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 14)`);

  let changed = false;
  next["schemaVersion"] = 15;
  changed = true;

  const fleet = next["fleet"];
  if (isPlainObject(fleet)) {
    const bots = fleet["bots"];
    if (isPlainObject(bots)) {
      for (const [botId, botCfgRaw] of Object.entries(bots)) {
        if (!isPlainObject(botCfgRaw)) continue;
        const botCfg = botCfgRaw as Record<string, unknown>;
        const clawdbot = botCfg["clawdbot"];
        if (clawdbot !== undefined && !isPlainObject(clawdbot)) {
          delete botCfg["clawdbot"];
          warnings.push(`gateway ${botId}: dropped clawdbot (expected object)`);
          changed = true;
          continue;
        }
        if (!isPlainObject(clawdbot)) continue;

        const moveLegacySurface = (params: { source: Record<string, unknown>; label: string; key: string }) => {
          if (!(params.key in params.source)) return;
          const legacyValue = params.source[params.key];
          delete params.source[params.key];
          changed = true;
          if (!isPlainObject(legacyValue) || Object.keys(legacyValue).length === 0) {
            if (legacyValue !== undefined) warnings.push(`gateway ${botId}: dropped ${params.label}.${params.key} (expected object)`);
            return;
          }
          const dest = ensureObject(botCfg, params.key);
          const merged = mergeLegacyIntoExisting({
            existing: dest,
            legacy: legacyValue,
            context: `migrate ${params.label}.${params.key}`,
          });
          if (merged) changed = true;
          warnings.push(`gateway ${botId}: moved ${params.label}.${params.key} -> ${params.key}`);
        };

        const openclaw = botCfg["openclaw"];
        if (isPlainObject(openclaw)) {
          moveLegacySurface({ source: openclaw, label: "openclaw", key: "channels" });
          moveLegacySurface({ source: openclaw, label: "openclaw", key: "agents" });
          moveLegacySurface({ source: openclaw, label: "openclaw", key: "hooks" });
          moveLegacySurface({ source: openclaw, label: "openclaw", key: "skills" });
          moveLegacySurface({ source: openclaw, label: "openclaw", key: "plugins" });
        }

        moveLegacySurface({ source: clawdbot, label: "clawdbot", key: "channels" });
        moveLegacySurface({ source: clawdbot, label: "clawdbot", key: "agents" });
        moveLegacySurface({ source: clawdbot, label: "clawdbot", key: "hooks" });
        moveLegacySurface({ source: clawdbot, label: "clawdbot", key: "skills" });
        moveLegacySurface({ source: clawdbot, label: "clawdbot", key: "plugins" });

        if (!isPlainObject(openclaw)) {
          botCfg["openclaw"] = structuredClone(clawdbot);
          warnings.push(`gateway ${botId}: moved clawdbot -> openclaw`);
          changed = true;
        } else {
          const merged = mergeLegacyIntoExisting({
            existing: openclaw,
            legacy: clawdbot,
            context: "migrate clawdbot -> openclaw",
          });
          if (merged) changed = true;
          warnings.push(`gateway ${botId}: merged clawdbot -> openclaw`);
        }

        delete botCfg["clawdbot"];
        changed = true;
      }
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

export function migrateClawletsConfigToV16(raw: unknown): MigrateToV16Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 16) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 15) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 15)`);

  let changed = false;
  next["schemaVersion"] = 16;
  changed = true;

  const fleet = next["fleet"];
  if (isPlainObject(fleet)) {
    const botOrder = toStringArray(fleet["botOrder"]);
    const gatewayOrder = toStringArray(fleet["gatewayOrder"]);
    if (botOrder.length > 0 && gatewayOrder.length === 0) {
      fleet["gatewayOrder"] = botOrder;
      changed = true;
      warnings.push("migrated fleet.botOrder -> fleet.gatewayOrder");
    }
    if ("botOrder" in fleet) {
      delete (fleet as any).botOrder;
      changed = true;
    }

    const bots = fleet["bots"];
    const gateways = fleet["gateways"];
    if (isPlainObject(bots) && !isPlainObject(gateways)) {
      fleet["gateways"] = bots;
      changed = true;
      warnings.push("migrated fleet.bots -> fleet.gateways");
    } else if (isPlainObject(bots) && isPlainObject(gateways)) {
      const merged = mergeLegacyIntoExisting({ existing: gateways, legacy: bots, context: "migrate fleet.bots -> fleet.gateways" });
      if (merged) changed = true;
      warnings.push("merged fleet.bots -> fleet.gateways");
    }
    if ("bots" in fleet) {
      delete (fleet as any).bots;
      changed = true;
    }

    const codex = fleet["codex"];
    if (isPlainObject(codex)) {
      const codexBots = toStringArray(codex["bots"]);
      const codexGateways = toStringArray(codex["gateways"]);
      if (codexBots.length > 0 && codexGateways.length === 0) {
        codex["gateways"] = codexBots;
        changed = true;
        warnings.push("migrated fleet.codex.bots -> fleet.codex.gateways");
      }
      if ("bots" in codex) {
        delete (codex as any).bots;
        changed = true;
      }
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

export function migrateClawletsConfigToV17(raw: unknown): MigrateToV17Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 17) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 16) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 16)`);

  let changed = false;
  next["schemaVersion"] = 17;
  changed = true;

  const fleet = isPlainObject(next["fleet"]) ? (next["fleet"] as Record<string, unknown>) : null;
  if (!fleet) throw new Error("invalid v16 config: missing fleet object");

  const gateways = isPlainObject(fleet["gateways"]) ? (fleet["gateways"] as Record<string, unknown>) : null;
  const gatewayOrder = toStringArray(fleet["gatewayOrder"]);
  if (!gateways) {
    throw new Error("invalid v16 config: missing fleet.gateways object (required for v17 host-scoped bots migration)");
  }

  const hosts = next["hosts"];
  if (!isPlainObject(hosts) || Object.keys(hosts).length === 0) {
    throw new Error("invalid v16 config: missing hosts (expected non-empty object)");
  }

  const defaultHost = typeof next["defaultHost"] === "string" ? String(next["defaultHost"]).trim() : "";
  const enabledHosts = Object.entries(hosts)
    .filter(([, cfg]) => isPlainObject(cfg) && Boolean((cfg as any).enable))
    .map(([name]) => name);

  let targetHost = "";
  if (defaultHost && isPlainObject((hosts as any)[defaultHost])) {
    targetHost = defaultHost;
  } else {
    const hostNames = Object.keys(hosts);
    if (hostNames.length === 1) {
      targetHost = hostNames[0]!;
    } else if (enabledHosts.length === 1) {
      targetHost = enabledHosts[0]!;
    }
  }

  if (!targetHost) {
    throw new Error(
      "cannot auto-migrate v16 -> v17: ambiguous target host for bots. Set defaultHost to an existing host (or enable exactly one host), then rerun migrate.",
    );
  }

  const hostCfg = ensureObject(hosts as Record<string, unknown>, targetHost);
  const existingBotsOrder = toStringArray(hostCfg["botsOrder"]);
  const nextBotsOrder = gatewayOrder.length > 0 ? gatewayOrder : Object.keys(gateways);
  if (existingBotsOrder.length === 0) {
    hostCfg["botsOrder"] = nextBotsOrder;
    changed = true;
  } else {
    const merged = [...existingBotsOrder];
    for (const id of nextBotsOrder) {
      if (!merged.includes(id)) merged.push(id);
    }
    hostCfg["botsOrder"] = merged;
    if (merged.length !== existingBotsOrder.length) changed = true;
    warnings.push(`host ${targetHost}: merged fleet.gatewayOrder -> hosts.${targetHost}.botsOrder`);
  }

  const hostBots = ensureObject(hostCfg, "bots");
  for (const [botId, botCfgRaw] of Object.entries(gateways)) {
    if (!isPlainObject(botCfgRaw)) continue;
    const existing = hostBots[botId];
    if (isPlainObject(existing)) {
      const merged = mergeLegacyIntoExisting({
        existing,
        legacy: botCfgRaw as Record<string, unknown>,
        context: `migrate fleet.gateways.${botId} -> hosts.${targetHost}.bots.${botId}`,
      });
      if (merged) changed = true;
      warnings.push(`host ${targetHost}: merged bot ${botId} from fleet.gateways`);
      continue;
    }
    hostBots[botId] = structuredClone(botCfgRaw);
    changed = true;
  }

  const botsOrder = toStringArray(hostCfg["botsOrder"]);
  for (const botId of botsOrder) {
    if (hostBots[botId] !== undefined) continue;
    hostBots[botId] = createNullProtoRecord<unknown>();
    changed = true;
    warnings.push(`host ${targetHost}: created missing hosts.${targetHost}.bots.${botId} from botsOrder`);
  }

  delete (fleet as any).gateways;
  delete (fleet as any).gatewayOrder;
  changed = true;

  const codex = fleet["codex"];
  if (isPlainObject(codex)) {
    const codexBots = toStringArray(codex["bots"]);
    const codexGateways = toStringArray(codex["gateways"]);
    if (codexGateways.length > 0 && codexBots.length === 0) {
      codex["bots"] = codexGateways;
      changed = true;
      warnings.push("migrated fleet.codex.gateways -> fleet.codex.bots");
    }
    if ("gateways" in codex) {
      delete (codex as any).gateways;
      changed = true;
    }
  }

  if (!defaultHost) {
    next["defaultHost"] = targetHost;
    changed = true;
    warnings.push(`set defaultHost -> ${targetHost}`);
  }

  return { ok: true, changed, warnings, migrated: next };
}

export function migrateClawletsConfigToV18(raw: unknown): MigrateToV18Result {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  const next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 18) return { ok: true, changed: false, warnings, migrated: next };
  if (schemaVersion !== 17) throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected 17)`);

  let changed = false;
  next["schemaVersion"] = 18;
  changed = true;

  const fleet = isPlainObject(next["fleet"]) ? (next["fleet"] as Record<string, unknown>) : null;
  if (fleet) {
    const codex = fleet["codex"];
    if (isPlainObject(codex)) {
      const codexBots = toStringArray(codex["bots"]);
      const codexGateways = toStringArray(codex["gateways"]);
      if (codexGateways.length === 0 && codexBots.length > 0) {
        codex["gateways"] = codexBots;
        changed = true;
        warnings.push("migrated fleet.codex.bots -> fleet.codex.gateways");
      }
      if ("bots" in codex) {
        delete (codex as any).bots;
        changed = true;
      }
    }
  }

  const hosts = next["hosts"];
  if (!isPlainObject(hosts) || Object.keys(hosts).length === 0) {
    throw new Error("invalid v17 config: missing hosts (expected non-empty object)");
  }

  for (const [hostName, hostCfgRaw] of Object.entries(hosts)) {
    if (!isPlainObject(hostCfgRaw)) continue;
    const hostCfg = hostCfgRaw as Record<string, unknown>;

    const existingGatewaysOrder = toStringArray(hostCfg["gatewaysOrder"]);
    const legacyBotsOrder = toStringArray(hostCfg["botsOrder"]);
    if (existingGatewaysOrder.length === 0 && legacyBotsOrder.length > 0) {
      hostCfg["gatewaysOrder"] = legacyBotsOrder;
      changed = true;
      warnings.push(`host ${hostName}: migrated hosts.${hostName}.botsOrder -> gatewaysOrder`);
    }
    if ("botsOrder" in hostCfg) {
      delete (hostCfg as any).botsOrder;
      changed = true;
    }

    const existingGateways = hostCfg["gateways"];
    const legacyBots = hostCfg["bots"];

    if (isPlainObject(existingGateways)) {
      if (isPlainObject(legacyBots)) {
        const merged = mergeLegacyIntoExisting({
          existing: existingGateways,
          legacy: legacyBots,
          context: `migrate hosts.${hostName}.bots -> hosts.${hostName}.gateways`,
        });
        if (merged) {
          changed = true;
          warnings.push(`host ${hostName}: merged legacy bots into gateways`);
        }
      }
    } else if (isPlainObject(legacyBots)) {
      hostCfg["gateways"] = structuredClone(legacyBots);
      changed = true;
      warnings.push(`host ${hostName}: migrated hosts.${hostName}.bots -> gateways`);
    } else if (existingGateways !== undefined) {
      warnings.push(`host ${hostName}: gateways present but invalid; fix hosts.${hostName}.gateways`);
    }

    if ("bots" in hostCfg) {
      delete (hostCfg as any).bots;
      changed = true;
    }

    const gatewaysOrder = toStringArray(hostCfg["gatewaysOrder"]);
    const gateways = isPlainObject(hostCfg["gateways"]) ? (hostCfg["gateways"] as Record<string, unknown>) : null;
    if (gateways && gatewaysOrder.length > 0) {
      for (const gatewayId of gatewaysOrder) {
        if (gateways[gatewayId] !== undefined) continue;
        gateways[gatewayId] = createNullProtoRecord<unknown>();
        changed = true;
        warnings.push(`host ${hostName}: created missing hosts.${hostName}.gateways.${gatewayId} from gatewaysOrder`);
      }
    }
  }

  return { ok: true, changed, warnings, migrated: next };
}

export type MigrateToLatestResult = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: Record<string, unknown>;
};

export function migrateClawletsConfigToLatest(raw: unknown): MigrateToLatestResult {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");
  let next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];
  let changed = false;

  const apply = (res: { changed: boolean; warnings: string[]; migrated: unknown }) => {
    warnings.push(...res.warnings);
    if (res.changed) changed = true;
    next = structuredClone(res.migrated) as Record<string, unknown>;
  };

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (schemaVersion === 18) return { ok: true, changed: false, warnings, migrated: next };

  if (schemaVersion === 8 || schemaVersion === 9 || schemaVersion === 10 || schemaVersion === 11) {
    apply(migrateClawletsConfigToV12(next));
  }

  if (Number(next["schemaVersion"] ?? 0) === 12) apply(migrateClawletsConfigToV13(next));
  if (Number(next["schemaVersion"] ?? 0) === 13) apply(migrateClawletsConfigToV14(next));
  if (Number(next["schemaVersion"] ?? 0) === 14) apply(migrateClawletsConfigToV15(next));
  if (Number(next["schemaVersion"] ?? 0) === 15) apply(migrateClawletsConfigToV16(next));
  if (Number(next["schemaVersion"] ?? 0) === 16) apply(migrateClawletsConfigToV17(next));
  if (Number(next["schemaVersion"] ?? 0) === 17) apply(migrateClawletsConfigToV18(next));

  if (Number(next["schemaVersion"] ?? 0) !== 18) {
    const finalVersion = Number(next["schemaVersion"] ?? 0);
    throw new Error(
      `unsupported schemaVersion: ${finalVersion} (expected 18). Update your config to host-scoped gateways (hosts.<host>.gateways + hosts.<host>.gatewaysOrder).`,
    );
  }

  return { ok: true, changed, warnings, migrated: next };
}
