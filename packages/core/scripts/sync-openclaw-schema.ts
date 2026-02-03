import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { compile } from "json-schema-to-typescript";
import { findRepoRoot } from "../src/lib/repo.js";

type SchemaArtifact = {
  openclawRev: string;
  version: string;
  schema: Record<string, unknown>;
  uiHints: Record<string, unknown>;
};

const argValue = (flag: string): string | null => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1] ?? null;
};

function readJson<T = unknown>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = stableSort(value[key]);
  }
  return out;
}

function writeJsonStable(filePath: string, data: unknown): void {
  const sorted = stableSort(data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
}

function readPinnedOpenclawRev(repoRoot: string): string {
  const lockPath = path.join(repoRoot, "flake.lock");
  const lock = readJson<any>(lockPath);
  const rev = lock?.nodes?.["openclaw-src"]?.locked?.rev;
  if (typeof rev !== "string" || !rev.trim()) {
    throw new Error("flake.lock missing openclaw-src.locked.rev");
  }
  return rev.trim();
}

function ensureOpenclawConfigPathEnv(): void {
  if (process.env.OPENCLAW_CONFIG_PATH) return;
  const tmpDir = path.join(os.tmpdir(), "clawlets-openclaw");
  const configPath = path.join(tmpDir, "openclaw.json");
  fs.mkdirSync(tmpDir, { recursive: true });
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, "{}\n", "utf8");
  process.env.OPENCLAW_CONFIG_PATH = configPath;
}

async function importOpenclawModule<T = unknown>(openclawSrc: string, relPath: string): Promise<T> {
  const url = pathToFileURL(path.join(openclawSrc, relPath)).href;
  return import(url) as Promise<T>;
}

function toPascalCase(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/g)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join("");
}

function normalizeKeyForMatch(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
}

function pickZodSchemaExport(mod: Record<string, unknown>, id: string): unknown | null {
  const explicit = `${toPascalCase(id)}ConfigSchema`;
  if (explicit in mod) return (mod as any)[explicit] as unknown;

  const candidates = Object.keys(mod)
    .filter((key) => key.endsWith("ConfigSchema"))
    .sort((a, b) => a.localeCompare(b));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return (mod as any)[candidates[0]!] as unknown;

  const normalizedId = normalizeKeyForMatch(id);
  for (const key of candidates) {
    const normalized = normalizeKeyForMatch(key.replace(/ConfigSchema$/, ""));
    if (normalized === normalizedId) return (mod as any)[key] as unknown;
  }
  return (mod as any)[candidates[0]!] as unknown;
}

async function loadChannelZodSchema(params: {
  openclawSrc: string;
  id: string;
  coreSchemas: Record<string, unknown>;
  jiti: ReturnType<typeof createJiti>;
}): Promise<unknown | null> {
  const core = params.coreSchemas[params.id];
  if (core) return core;

  const extSchemaPath = path.join(params.openclawSrc, "extensions", params.id, "src", "config-schema.ts");
  if (!fs.existsSync(extSchemaPath)) return null;

  const mod = params.jiti(extSchemaPath) as Record<string, unknown>;
  return pickZodSchemaExport(mod, params.id);
}

async function buildSchemaArtifact(params: { openclawSrc: string; openclawRev: string }): Promise<SchemaArtifact> {
  const src = params.openclawSrc;
  ensureOpenclawConfigPathEnv();

  const pluginSdkAlias = path.join(src, "src", "plugin-sdk", "index.ts");
  if (!fs.existsSync(pluginSdkAlias)) {
    throw new Error(`missing openclaw plugin-sdk: ${pluginSdkAlias}`);
  }
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"],
    alias: { "openclaw/plugin-sdk": pluginSdkAlias },
  });

  const schemaMod = await importOpenclawModule<any>(src, "src/config/schema.ts");
  if (typeof schemaMod.buildConfigSchema !== "function") {
    throw new Error("buildConfigSchema not found in openclaw src/config/schema.ts");
  }

  const pluginManifestsMod = await importOpenclawModule<any>(src, "src/plugins/manifest-registry.ts");
  if (typeof pluginManifestsMod.loadPluginManifestRegistry !== "function") {
    throw new Error("loadPluginManifestRegistry not found in openclaw src/plugins/manifest-registry.ts");
  }

  const channelCatalogMod = await importOpenclawModule<any>(src, "src/channels/plugins/catalog.ts");
  if (typeof channelCatalogMod.listChannelPluginCatalogEntries !== "function") {
    throw new Error("listChannelPluginCatalogEntries not found in openclaw src/channels/plugins/catalog.ts");
  }

  const channelRegistryMod = await importOpenclawModule<any>(src, "src/channels/registry.ts");
  const getChatChannelMeta =
    typeof channelRegistryMod.getChatChannelMeta === "function"
      ? (channelRegistryMod.getChatChannelMeta as (id: string) => { label?: string; blurb?: string } | undefined)
      : null;

  const channelConfigMod = await importOpenclawModule<any>(src, "src/channels/plugins/config-schema.ts");
  if (typeof channelConfigMod.buildChannelConfigSchema !== "function") {
    throw new Error("buildChannelConfigSchema not found in openclaw src/channels/plugins/config-schema.ts");
  }

  const providersCoreMod = await importOpenclawModule<any>(src, "src/config/zod-schema.providers-core.ts");
  const providersWhatsappMod = await importOpenclawModule<any>(src, "src/config/zod-schema.providers-whatsapp.ts");
  const lineConfigMod = await importOpenclawModule<any>(src, "src/line/config-schema.ts");

  const coreSchemas: Record<string, unknown> = {
    whatsapp: providersWhatsappMod.WhatsAppConfigSchema,
    telegram: providersCoreMod.TelegramConfigSchema,
    discord: providersCoreMod.DiscordConfigSchema,
    googlechat: providersCoreMod.GoogleChatConfigSchema,
    slack: providersCoreMod.SlackConfigSchema,
    signal: providersCoreMod.SignalConfigSchema,
    imessage: providersCoreMod.IMessageConfigSchema,
    msteams: providersCoreMod.MSTeamsConfigSchema,
    line: lineConfigMod.LineConfigSchema,
  };

  const catalogEntries = channelCatalogMod.listChannelPluginCatalogEntries({ workspaceDir: src }) as Array<{
    id?: unknown;
    meta?: { label?: unknown; blurb?: unknown };
  }>;
  const manifestRegistry = pluginManifestsMod.loadPluginManifestRegistry({
    config: {},
    workspaceDir: src,
    cache: false,
  }) as { plugins?: Array<any> };

  const channelMetaById = new Map<string, { label?: string; blurb?: string }>();
  for (const entry of catalogEntries) {
    const id = String(entry?.id ?? "").trim();
    if (!id) continue;
    const label = typeof entry?.meta?.label === "string" ? entry.meta.label : undefined;
    const blurb = typeof entry?.meta?.blurb === "string" ? entry.meta.blurb : undefined;
    channelMetaById.set(id, { label, blurb });
  }

  const channelIds = new Set<string>();
  for (const plugin of manifestRegistry.plugins ?? []) {
    const list = Array.isArray(plugin?.channels) ? (plugin.channels as unknown[]) : [];
    for (const channel of list) {
      const id = typeof channel === "string" ? channel.trim() : "";
      if (id) channelIds.add(id);
    }
  }
  for (const entry of catalogEntries) {
    const id = String(entry?.id ?? "").trim();
    if (id) channelIds.add(id);
  }

  const channels: Array<Record<string, unknown>> = [];
  const missingChannelSchemas: string[] = [];
  const sortedChannelIds = Array.from(channelIds).sort((a, b) => a.localeCompare(b));
  for (const id of sortedChannelIds) {
    const zodSchema = await loadChannelZodSchema({ openclawSrc: src, id, coreSchemas, jiti });
    if (!zodSchema) {
      missingChannelSchemas.push(id);
      continue;
    }
    let configSchema: Record<string, unknown>;
    try {
      const built = channelConfigMod.buildChannelConfigSchema(zodSchema as any) as { schema?: Record<string, unknown> };
      configSchema = (built?.schema ?? {}) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`failed to build channel config schema for ${id}: ${String((err as Error)?.message || err)}`);
    }

    const meta = channelMetaById.get(id);
    const isCoreChatChannel = ["telegram", "whatsapp", "discord", "googlechat", "slack", "signal", "imessage"].includes(id);
    const coreMeta = isCoreChatChannel && getChatChannelMeta ? getChatChannelMeta(id) : undefined;

    channels.push({
      id,
      label: meta?.label ?? coreMeta?.label ?? id,
      description: meta?.blurb ?? coreMeta?.blurb ?? undefined,
      configSchema,
    });
  }

  if (missingChannelSchemas.length > 0) {
    missingChannelSchemas.sort((a, b) => a.localeCompare(b));
    throw new Error(
      `missing config schema for channel(s): ${missingChannelSchemas.slice(0, 8).join(", ")}${missingChannelSchemas.length > 8 ? ` (+${missingChannelSchemas.length - 8})` : ""}`,
    );
  }

  const plugins = (manifestRegistry.plugins ?? [])
    .slice()
    .sort((a: any, b: any) => String(a?.id ?? "").localeCompare(String(b?.id ?? "")))
    .map((plugin: any) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      configSchema: plugin.configSchema,
      configUiHints: plugin.configUiHints,
    }));

  const schemaRes = schemaMod.buildConfigSchema({ plugins, channels });

  return {
    openclawRev: params.openclawRev,
    version: String(schemaRes.version || ""),
    schema: (schemaRes.schema ?? {}) as Record<string, unknown>,
    uiHints: (schemaRes.uiHints ?? {}) as Record<string, unknown>,
  };
}

async function generateArtifacts(params: { repoRoot: string; openclawSrc: string; outDir: string }): Promise<void> {
  const openclawRev = readPinnedOpenclawRev(params.repoRoot);

  const schemaArtifact = await buildSchemaArtifact({ openclawSrc: params.openclawSrc, openclawRev });
  const schemaPath = path.join(params.outDir, "openclaw-config.schema.json");
  writeJsonStable(schemaPath, schemaArtifact);

  const schemaSorted = stableSort(schemaArtifact.schema) as Record<string, unknown>;
  const banner = [
    "/*",
    "  This file is generated by packages/core/scripts/sync-openclaw-schema.ts.",
    "  Do not edit by hand.",
    "",
    `  openclawRev: ${openclawRev}`,
    "*/",
    "",
  ].join("\n");
  const compiled = await compile(schemaSorted as any, "OpenclawConfig", {
    bannerComment: banner,
    additionalProperties: true,
    style: { singleQuote: false },
  });

  const extra = [
    "",
    "export const OPENCLAW_REV = " + JSON.stringify(openclawRev) + " as const;",
    "export type OpenclawChannels = OpenclawConfig[\"channels\"];",
    "export type OpenclawAgents = OpenclawConfig[\"agents\"];",
    "export type OpenclawHooks = OpenclawConfig[\"hooks\"];",
    "export type OpenclawSkills = OpenclawConfig[\"skills\"];",
    "export type OpenclawPlugins = OpenclawConfig[\"plugins\"];",
    "",
  ].join("\n");
  const typesPath = path.join(params.outDir, "openclaw-config.types.ts");
  writeText(typesPath, `${compiled.trimEnd()}\n${extra}`);

  console.log(`ok: wrote ${path.relative(params.repoRoot, schemaPath)}`);
  console.log(`ok: wrote ${path.relative(params.repoRoot, typesPath)}`);
}

function copyFromNix(params: { repoRoot: string; outDir: string }): void {
  const outPath = execFileSync("nix", ["build", "--print-out-paths", ".#openclaw-schema-artifacts"], {
    cwd: params.repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
  })
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .at(-1);
  if (!outPath) throw new Error("nix build did not return an output path");

  const files = ["openclaw-config.schema.json", "openclaw-config.types.ts"] as const;
  fs.mkdirSync(params.outDir, { recursive: true });
  for (const file of files) {
    const src = path.join(outPath, file);
    const dest = path.join(params.outDir, file);
    if (!fs.existsSync(src)) throw new Error(`missing file in nix output: ${src}`);
    fs.copyFileSync(src, dest);
  }

  console.log(`ok: synced from nix store path ${outPath}`);
}

const main = async () => {
  const repoRoot = findRepoRoot(process.cwd());
  const mode = (argValue("--mode") ?? process.env.OPENCLAW_SCHEMA_SYNC_MODE ?? "").trim() || "copy";
  const outDir = path.resolve(repoRoot, argValue("--out-dir") ?? path.join(repoRoot, "packages", "core", "src", "generated"));

  if (mode === "copy") {
    copyFromNix({ repoRoot, outDir });
    return;
  }
  if (mode !== "generate") {
    throw new Error(`invalid --mode: ${mode} (expected copy|generate)`);
  }

  const openclawSrc = argValue("--src") ?? process.env.OPENCLAW_SRC;
  if (!openclawSrc) {
    throw new Error("missing --src <openclaw repo path> (or set OPENCLAW_SRC)");
  }
  const absSrc = path.resolve(repoRoot, openclawSrc);
  if (!fs.existsSync(absSrc)) throw new Error(`openclaw src not found: ${absSrc}`);
  await generateArtifacts({ repoRoot, openclawSrc: absSrc, outDir });
};

main().catch((err) => {
  console.error(`error: ${String((err as Error)?.message || err)}`);
  process.exit(1);
});
