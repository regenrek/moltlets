import { CLAWLETS_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";
import { isPlainObject } from "./helpers.js";
import { z } from "zod";
import { HostNameSchema } from "@clawlets/shared/lib/identifiers";
import { FleetSchema } from "./schema-fleet.js";
import { HostSchema } from "./schema-host.js";
import { CattleSchema } from "./schema-cattle.js";
import { splitFullConfig } from "./split.js";

type MigrationStepResult = {
  config: Record<string, unknown>;
  warnings?: string[];
  openclawConfig?: Record<string, unknown>;
};

type MigrationStep = (input: Record<string, unknown>) => MigrationStepResult;

const MIGRATIONS: Record<number, MigrationStep> = {
  1: (input): MigrationStepResult => {
    const LegacyV1Schema = z.object({
      schemaVersion: z.literal(1),
      defaultHost: HostNameSchema.optional(),
      baseFlake: z.string().trim().default(""),
      fleet: FleetSchema.default(() => ({
        secretEnv: {},
        secretFiles: {},
        sshAuthorizedKeys: [],
        sshKnownHosts: [],
        codex: { enable: false, gateways: [] },
        backups: { restic: { enable: false, repository: "" } },
      })),
      cattle: CattleSchema,
      hosts: z.record(HostNameSchema, HostSchema).refine((value) => Object.keys(value).length > 0, {
        message: "hosts must not be empty",
      }),
    });

    const legacy = LegacyV1Schema.parse(input);
    const upgradedForSplit = {
      ...legacy,
      schemaVersion: 2 as const,
    };
    const split = splitFullConfig({ config: upgradedForSplit as any });
    return {
      config: split.infra as unknown as Record<string, unknown>,
      openclawConfig: split.openclaw as unknown as Record<string, unknown>,
      warnings: ["migrated v1 monolithic config to split fleet/clawlets.json + fleet/openclaw.json"],
    };
  },
};

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
