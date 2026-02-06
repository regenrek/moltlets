import fs from "node:fs";
import path from "node:path";
import type { RepoLayout } from "../../repo-layout.js";
import { getRepoLayout } from "../../repo-layout.js";
import { writeFileAtomic } from "../storage/fs-safe.js";
import { assertNoLegacyEnvSecrets, assertNoLegacyHostKeys } from "./clawlets-config-legacy.js";
import { migrateClawletsConfigToLatest } from "./migrate.js";
import { ClawletsConfigSchema, type ClawletsConfig } from "./schema.js";
import { InfraConfigSchema, type InfraConfig } from "./schema-infra.js";
import { OpenClawConfigSchema, type OpenClawConfig } from "./schema-openclaw.js";
import { getDefaultOpenClawConfig, mergeSplitConfigs, splitFullConfig } from "./split.js";

function writeFileAtomicSync(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`);
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, filePath);
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${filePath}`);
  }
}

function readOpenClawConfigIfPresent(layout: RepoLayout): OpenClawConfig | null {
  const openclawPath = layout.openclawConfigPath;
  if (!fs.existsSync(openclawPath)) return null;
  return OpenClawConfigSchema.parse(readJsonFile(openclawPath));
}

function migrateLegacyIfNeeded(layout: RepoLayout): { infra: InfraConfig; openclaw: OpenClawConfig | null } {
  const infraPath = layout.clawletsConfigPath;
  if (!fs.existsSync(infraPath)) throw new Error(`missing clawlets config: ${infraPath}`);
  const rawText = fs.readFileSync(infraPath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error(`invalid JSON: ${infraPath}`);
  }

  assertNoLegacyHostKeys(raw);
  assertNoLegacyEnvSecrets(raw);

  const schemaVersion = Number((raw as any)?.schemaVersion ?? 0);
  if (schemaVersion !== 1) {
    return {
      infra: InfraConfigSchema.parse(raw),
      openclaw: readOpenClawConfigIfPresent(layout),
    };
  }

  const migrated = migrateClawletsConfigToLatest(raw);
  const infra = InfraConfigSchema.parse(migrated.migrated);
  const openclaw = OpenClawConfigSchema.parse(migrated.openclawConfig || getDefaultOpenClawConfig());

  const backupPath = `${infraPath}.v1.bak`;
  if (!fs.existsSync(backupPath)) writeFileAtomicSync(backupPath, `${rawText.trimEnd()}\n`);

  writeFileAtomicSync(layout.clawletsConfigPath, `${JSON.stringify(infra, null, 2)}\n`);
  writeFileAtomicSync(layout.openclawConfigPath, `${JSON.stringify(openclaw, null, 2)}\n`);

  return { infra, openclaw };
}

function readExistingSplit(params: { repoRootFromConfigPath: string }): {
  existingInfra: InfraConfig | null;
  existingOpenclaw: OpenClawConfig | null;
} {
  const layout = getRepoLayout(params.repoRootFromConfigPath);
  let existingInfra: InfraConfig | null = null;
  let existingOpenclaw: OpenClawConfig | null = null;

  if (fs.existsSync(layout.clawletsConfigPath)) {
    try {
      existingInfra = InfraConfigSchema.parse(readJsonFile(layout.clawletsConfigPath));
    } catch {
      existingInfra = null;
    }
  }
  if (fs.existsSync(layout.openclawConfigPath)) {
    try {
      existingOpenclaw = OpenClawConfigSchema.parse(readJsonFile(layout.openclawConfigPath));
    } catch {
      existingOpenclaw = null;
    }
  }

  return { existingInfra, existingOpenclaw };
}

export function loadInfraConfig(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: InfraConfig;
} {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const { infra } = migrateLegacyIfNeeded(layout);
  return { layout, configPath: layout.clawletsConfigPath, config: infra };
}

export function loadOpenClawConfig(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: OpenClawConfig;
} | null {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  migrateLegacyIfNeeded(layout);
  const config = readOpenClawConfigIfPresent(layout);
  if (!config) return null;
  return { layout, configPath: layout.openclawConfigPath, config };
}

export function loadFullConfig(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  infraConfigPath: string;
  openclawConfigPath: string;
  infra: InfraConfig;
  openclaw: OpenClawConfig | null;
  config: ClawletsConfig;
} {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const { infra, openclaw } = migrateLegacyIfNeeded(layout);
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

export function loadClawletsConfigRaw(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: unknown;
} {
  const { layout, infraConfigPath, config } = loadFullConfig(params);
  return { layout, configPath: infraConfigPath, config };
}

export function loadClawletsConfig(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: ClawletsConfig;
} {
  const { layout, infraConfigPath, config } = loadFullConfig(params);
  return { layout, configPath: infraConfigPath, config: ClawletsConfigSchema.parse(config) };
}

export async function writeInfraConfig(params: { configPath: string; config: InfraConfig }): Promise<void> {
  const config = InfraConfigSchema.parse(params.config);
  await writeFileAtomic(params.configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function writeOpenClawConfig(params: { configPath: string; config: OpenClawConfig }): Promise<void> {
  const config = OpenClawConfigSchema.parse(params.config);
  await writeFileAtomic(params.configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function writeClawletsConfig(params: { configPath: string; config: ClawletsConfig }): Promise<void> {
  const full = ClawletsConfigSchema.parse(params.config);
  const repoRootFromConfigPath = path.dirname(path.dirname(params.configPath));
  const layout = getRepoLayout(repoRootFromConfigPath);
  const { existingInfra, existingOpenclaw } = readExistingSplit({ repoRootFromConfigPath });
  const split = splitFullConfig({ config: full, existingInfra, existingOpenclaw });

  await writeInfraConfig({ configPath: layout.clawletsConfigPath, config: split.infra });
  await writeOpenClawConfig({ configPath: layout.openclawConfigPath, config: split.openclaw });
}
