import path from "node:path";
import type { RepoLayout } from "../../repo-layout.js";
import { getRepoLayout } from "../../repo-layout.js";
import type { ConfigStore, MaybePromise } from "../storage/config-store.js";
import { FileSystemConfigStore } from "../storage/fs-config-store.js";
import { requireSyncResult } from "../storage/require-sync-result.js";
import { ClawletsConfigSchema, type ClawletsConfig } from "./schema.js";
import { InfraConfigSchema, type InfraConfig } from "./schema-infra.js";
import { OpenClawConfigSchema, type OpenClawConfig } from "./schema-openclaw.js";
import { mergeSplitConfigs, splitFullConfig } from "./split.js";

const defaultStore = new FileSystemConfigStore();

async function toPromise<T>(value: MaybePromise<T>): Promise<T> {
  return await value;
}

function readJsonFile(store: ConfigStore, filePath: string): unknown {
  const raw = requireSyncResult(store.readText(filePath), "readText", "load* APIs");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${filePath}`);
  }
}

async function readJsonFileAsync(store: ConfigStore, filePath: string): Promise<unknown> {
  const raw = await toPromise(store.readText(filePath));
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${filePath}`);
  }
}

function readOpenClawConfigIfPresent(store: ConfigStore, layout: RepoLayout): OpenClawConfig | null {
  const openclawPath = layout.openclawConfigPath;
  if (!requireSyncResult(store.exists(openclawPath), "exists", "load* APIs")) return null;
  return OpenClawConfigSchema.parse(readJsonFile(store, openclawPath));
}

async function readOpenClawConfigIfPresentAsync(store: ConfigStore, layout: RepoLayout): Promise<OpenClawConfig | null> {
  const openclawPath = layout.openclawConfigPath;
  if (!(await toPromise(store.exists(openclawPath)))) return null;
  return OpenClawConfigSchema.parse(await readJsonFileAsync(store, openclawPath));
}

function readInfraConfig(store: ConfigStore, layout: RepoLayout): InfraConfig {
  const infraPath = layout.clawletsConfigPath;
  if (!requireSyncResult(store.exists(infraPath), "exists", "load* APIs")) {
    throw new Error(`missing clawlets config: ${infraPath}`);
  }
  return InfraConfigSchema.parse(readJsonFile(store, infraPath));
}

async function readInfraConfigAsync(store: ConfigStore, layout: RepoLayout): Promise<InfraConfig> {
  const infraPath = layout.clawletsConfigPath;
  if (!(await toPromise(store.exists(infraPath)))) {
    throw new Error(`missing clawlets config: ${infraPath}`);
  }
  return InfraConfigSchema.parse(await readJsonFileAsync(store, infraPath));
}

async function readExistingSplitAsync(params: { repoRootFromConfigPath: string; store: ConfigStore }): Promise<{
  existingInfra: InfraConfig | null;
  existingOpenclaw: OpenClawConfig | null;
}> {
  const layout = getRepoLayout(params.repoRootFromConfigPath);
  const store = params.store;
  let existingInfra: InfraConfig | null = null;
  let existingOpenclaw: OpenClawConfig | null = null;

  if (await toPromise(store.exists(layout.clawletsConfigPath))) {
    try {
      existingInfra = InfraConfigSchema.parse(await readJsonFileAsync(store, layout.clawletsConfigPath));
    } catch {
      existingInfra = null;
    }
  }
  if (await toPromise(store.exists(layout.openclawConfigPath))) {
    try {
      existingOpenclaw = OpenClawConfigSchema.parse(await readJsonFileAsync(store, layout.openclawConfigPath));
    } catch {
      existingOpenclaw = null;
    }
  }

  return { existingInfra, existingOpenclaw };
}

export function loadInfraConfig(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): {
  layout: RepoLayout;
  configPath: string;
  config: InfraConfig;
} {
  const store = params.store ?? defaultStore;
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const config = readInfraConfig(store, layout);
  return { layout, configPath: layout.clawletsConfigPath, config };
}

export async function loadInfraConfigAsync(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): Promise<{
  layout: RepoLayout;
  configPath: string;
  config: InfraConfig;
}> {
  const store = params.store ?? defaultStore;
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const config = await readInfraConfigAsync(store, layout);
  return { layout, configPath: layout.clawletsConfigPath, config };
}

export function loadOpenClawConfig(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): {
  layout: RepoLayout;
  configPath: string;
  config: OpenClawConfig;
} | null {
  const store = params.store ?? defaultStore;
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  readInfraConfig(store, layout);
  const config = readOpenClawConfigIfPresent(store, layout);
  if (!config) return null;
  return { layout, configPath: layout.openclawConfigPath, config };
}

export async function loadOpenClawConfigAsync(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): Promise<{
  layout: RepoLayout;
  configPath: string;
  config: OpenClawConfig;
} | null> {
  const store = params.store ?? defaultStore;
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  await readInfraConfigAsync(store, layout);
  const config = await readOpenClawConfigIfPresentAsync(store, layout);
  if (!config) return null;
  return { layout, configPath: layout.openclawConfigPath, config };
}

export function loadFullConfig(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): {
  layout: RepoLayout;
  infraConfigPath: string;
  openclawConfigPath: string;
  infra: InfraConfig;
  openclaw: OpenClawConfig | null;
  config: ClawletsConfig;
} {
  const store = params.store ?? defaultStore;
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const infra = readInfraConfig(store, layout);
  const openclaw = readOpenClawConfigIfPresent(store, layout);
  const config = mergeSplitConfigs({ infra, openclaw });
  return {
    layout,
    infraConfigPath: layout.clawletsConfigPath,
    openclawConfigPath: layout.openclawConfigPath,
    infra,
    openclaw,
    config,
  };
}

export async function loadFullConfigAsync(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): Promise<{
  layout: RepoLayout;
  infraConfigPath: string;
  openclawConfigPath: string;
  infra: InfraConfig;
  openclaw: OpenClawConfig | null;
  config: ClawletsConfig;
}> {
  const store = params.store ?? defaultStore;
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const infra = await readInfraConfigAsync(store, layout);
  const openclaw = await readOpenClawConfigIfPresentAsync(store, layout);
  const config = mergeSplitConfigs({ infra, openclaw });
  return {
    layout,
    infraConfigPath: layout.clawletsConfigPath,
    openclawConfigPath: layout.openclawConfigPath,
    infra,
    openclaw,
    config,
  };
}

export function loadClawletsConfig(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): {
  layout: RepoLayout;
  configPath: string;
  config: ClawletsConfig;
} {
  const { layout, infraConfigPath, config } = loadFullConfig(params);
  return { layout, configPath: infraConfigPath, config: ClawletsConfigSchema.parse(config) };
}

export async function loadClawletsConfigAsync(params: {
  repoRoot: string;
  runtimeDir?: string;
  store?: ConfigStore;
}): Promise<{
  layout: RepoLayout;
  configPath: string;
  config: ClawletsConfig;
}> {
  const { layout, infraConfigPath, config } = await loadFullConfigAsync(params);
  return { layout, configPath: infraConfigPath, config: ClawletsConfigSchema.parse(config) };
}

export async function writeInfraConfig(params: {
  configPath: string;
  config: InfraConfig;
  store?: ConfigStore;
}): Promise<void> {
  await writeConfigFile({
    configPath: params.configPath,
    config: params.config,
    schema: InfraConfigSchema,
    store: params.store,
  });
}

export async function writeOpenClawConfig(params: {
  configPath: string;
  config: OpenClawConfig;
  store?: ConfigStore;
}): Promise<void> {
  await writeConfigFile({
    configPath: params.configPath,
    config: params.config,
    schema: OpenClawConfigSchema,
    store: params.store,
  });
}

async function writeConfigFile<T>(params: {
  configPath: string;
  config: T;
  schema: { parse: (value: unknown) => T };
  store?: ConfigStore;
}): Promise<void> {
  const store = params.store ?? defaultStore;
  const config = params.schema.parse(params.config);
  const nextText = `${JSON.stringify(config, null, 2)}\n`;
  if (await toPromise(store.exists(params.configPath))) {
    try {
      const existingText = await toPromise(store.readText(params.configPath));
      if (existingText === nextText) return;
    } catch {
      // ignore; fall through to write
    }
  }
  await store.writeTextAtomic(params.configPath, nextText);
}

export async function writeClawletsConfig(params: {
  configPath: string;
  config: ClawletsConfig;
  store?: ConfigStore;
}): Promise<void> {
  const store = params.store ?? defaultStore;
  const full = ClawletsConfigSchema.parse(params.config);
  const repoRootFromConfigPath = path.dirname(path.dirname(params.configPath));
  const layout = getRepoLayout(repoRootFromConfigPath);
  const { existingInfra, existingOpenclaw } = await readExistingSplitAsync({ repoRootFromConfigPath, store });
  const split = splitFullConfig({ config: full, existingInfra, existingOpenclaw });

  await writeInfraConfig({ configPath: layout.clawletsConfigPath, config: split.infra, store });
  await writeOpenClawConfig({ configPath: layout.openclawConfigPath, config: split.openclaw, store });
}
