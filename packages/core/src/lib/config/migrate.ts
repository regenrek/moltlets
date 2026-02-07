import { CLAWLETS_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";
import { isPlainObject } from "./helpers.js";

type MigrationStepResult = {
  config: Record<string, unknown>;
  warnings?: string[];
  openclawConfig?: Record<string, unknown>;
};

type MigrationStep = (input: Record<string, unknown>) => MigrationStepResult;

// Add shipped migrations here (e.g. v2 -> v3). Pre-release migrations are intentionally omitted.
const MIGRATIONS: Record<number, MigrationStep> = {};

export type MigrateToLatestResult = {
  ok: true;
  changed: boolean;
  warnings: string[];
  migrated: Record<string, unknown>;
  openclawConfig: Record<string, unknown> | null;
};

export function migrateClawletsConfigToLatest(raw: unknown): MigrateToLatestResult {
  if (!isPlainObject(raw)) throw new Error("invalid config (expected JSON object)");

  let next = structuredClone(raw) as Record<string, unknown>;
  const warnings: string[] = [];

  const schemaVersion = Number(next["schemaVersion"] ?? 0);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error(`invalid schemaVersion: ${schemaVersion} (expected ${CLAWLETS_CONFIG_SCHEMA_VERSION})`);
  }

  if (schemaVersion > CLAWLETS_CONFIG_SCHEMA_VERSION) {
    throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected ${CLAWLETS_CONFIG_SCHEMA_VERSION})`);
  }

  if (schemaVersion === CLAWLETS_CONFIG_SCHEMA_VERSION) {
    return { ok: true, changed: false, warnings, migrated: next, openclawConfig: null };
  }

  let current = schemaVersion;
  let changed = false;
  let openclawConfig: Record<string, unknown> | null = null;
  while (current < CLAWLETS_CONFIG_SCHEMA_VERSION) {
    const step = MIGRATIONS[current];
    if (!step) {
      throw new Error(`unsupported schemaVersion: ${schemaVersion} (expected ${CLAWLETS_CONFIG_SCHEMA_VERSION})`);
    }
    const res = step(next);
    next = res.config;
    if (res.openclawConfig) openclawConfig = res.openclawConfig;
    if (res.warnings?.length) warnings.push(...res.warnings);
    current += 1;
    next["schemaVersion"] = current;
    changed = true;
  }

  return { ok: true, changed, warnings, migrated: next, openclawConfig };
}
