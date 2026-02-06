import { z } from "zod";
import { HostNameSchema } from "@clawlets/shared/lib/identifiers";
import { CLAWLETS_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";
import { FleetSchema } from "./schema-fleet.js";
import { HostSchema } from "./schema-host.js";
import { CattleSchema } from "./schema-cattle.js";
import { addOpenclawSchemaIssues } from "./openclaw-validation.js";
export { InfraConfigSchema, InfraHostConfigSchema, type InfraConfig, type InfraHostConfig } from "./schema-infra.js";
export { OpenClawConfigSchema, OpenClawHostConfigSchema, type OpenClawConfig, type OpenClawHostConfig } from "./schema-openclaw.js";

export const ClawletsConfigSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(CLAWLETS_CONFIG_SCHEMA_VERSION)]),
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
  })
  .superRefine((cfg, ctx) => {
    if (cfg.defaultHost && !cfg.hosts[cfg.defaultHost]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultHost"],
        message: `defaultHost not found in hosts: ${cfg.defaultHost}`,
      });
    }

    addOpenclawSchemaIssues({ config: cfg, ctx });
  });

export type ClawletsConfig = z.infer<typeof ClawletsConfigSchema>;
export type ClawletsHostConfig = z.infer<typeof HostSchema>;

export function validateClawletsConfigSchema(raw: unknown): ClawletsConfig {
  return ClawletsConfigSchema.parse(raw);
}
