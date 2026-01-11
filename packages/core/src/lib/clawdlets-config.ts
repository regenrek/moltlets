import fs from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./fs-safe.js";
import type { RepoLayout } from "../repo-layout.js";
import { getRepoLayout } from "../repo-layout.js";

export const CLAWDLETS_CONFIG_SCHEMA_VERSION = 1 as const;

const IdSchema = z.string().trim().min(1);
const SAFE_HOSTNAME_RE = /^[a-z][a-z0-9-]*$/;
const HostNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_HOSTNAME_RE.test(v), { message: "invalid host name (use [a-z][a-z0-9-]*)" });
const BotIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => /^[a-z][a-z0-9_-]*$/.test(v), { message: "invalid bot id (use [a-z][a-z0-9_-]*)" });

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.any());

const FleetSchema = z.object({
  guildId: z.string().trim().default(""),
  bots: z
    .array(BotIdSchema)
    .default([])
    .superRefine((bots, ctx) => {
      const seen = new Set<string>();
      for (const b of bots) {
        if (seen.has(b)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate bot id: ${b}` });
        seen.add(b);
      }
    }),
  botOverrides: z.record(BotIdSchema, JsonObjectSchema).default({}),
  routingOverrides: z.record(BotIdSchema, JsonObjectSchema).default({}),
  codex: z
    .object({
      enable: z.boolean().default(false),
      bots: z.array(BotIdSchema).default([]),
    })
    .default({ enable: false, bots: [] }),
  backups: z
    .object({
      restic: z
        .object({
          enable: z.boolean().default(false),
          repository: z.string().trim().default(""),
        })
        .default({ enable: false, repository: "" }),
    })
    .default({ restic: { enable: false, repository: "" } }),
});

const HostSchema = z.object({
  enable: z.boolean().default(false),
  bootstrapSsh: z.boolean().default(true),
  diskDevice: z.string().trim().default("/dev/disk/by-id/CHANGE_ME"),
  sshAuthorizedKeys: z.array(z.string().trim().min(1)).default([]),
  tailnet: z
    .object({
      mode: z.enum(["none", "tailscale", "wireguard"]).default("none"),
      wireguardAdminPeers: z.array(z.string().trim().min(1)).default([]),
    })
    .default({ mode: "none", wireguardAdminPeers: [] }),
  agentModelPrimary: z.string().trim().default("zai/glm-4.7"),
});

export const ClawdletsConfigSchema = z.object({
  schemaVersion: z.literal(CLAWDLETS_CONFIG_SCHEMA_VERSION),
  fleet: FleetSchema.default({}),
  hosts: z.record(HostNameSchema, HostSchema).refine((v) => Object.keys(v).length > 0, {
    message: "hosts must not be empty",
  }),
});

export type ClawdletsConfig = z.infer<typeof ClawdletsConfigSchema>;
export type ClawdletsHostConfig = z.infer<typeof HostSchema>;

export const SafeHostNameSchema = HostNameSchema;

export function assertSafeHostName(hostName: string): void {
  const v = String(hostName || "").trim();
  if (!SAFE_HOSTNAME_RE.test(v)) {
    throw new Error(`invalid host name: ${v} (use [a-z][a-z0-9-]*)`);
  }
}

export function createDefaultClawdletsConfig(params: { host: string; bots?: string[] }): ClawdletsConfig {
  const host = params.host.trim() || "clawdbot-fleet-host";
  const bots = (params.bots || ["maren", "sonja", "gunnar", "melinda"]).map((b) => b.trim()).filter(Boolean);
  return ClawdletsConfigSchema.parse({
    schemaVersion: CLAWDLETS_CONFIG_SCHEMA_VERSION,
    fleet: {
      guildId: "",
      bots,
      botOverrides: {},
      routingOverrides: {},
      codex: { enable: false, bots: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    hosts: {
      [host]: {
        enable: false,
        bootstrapSsh: true,
        diskDevice: "/dev/disk/by-id/CHANGE_ME",
        sshAuthorizedKeys: [],
        tailnet: { mode: "none", wireguardAdminPeers: [] },
        agentModelPrimary: "zai/glm-4.7",
      },
    },
  });
}

export function loadClawdletsConfig(params: { repoRoot: string; stackDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: ClawdletsConfig;
} {
  const layout = getRepoLayout(params.repoRoot, params.stackDir);
  const configPath = layout.clawdletsConfigPath;
  if (!fs.existsSync(configPath)) throw new Error(`missing clawdlets config: ${configPath}`);
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${configPath}`);
  }
  const config = ClawdletsConfigSchema.parse(parsed);
  return { layout, configPath, config };
}

export async function writeClawdletsConfig(params: { configPath: string; config: ClawdletsConfig }): Promise<void> {
  await writeFileAtomic(params.configPath, `${JSON.stringify(params.config, null, 2)}\n`);
}
