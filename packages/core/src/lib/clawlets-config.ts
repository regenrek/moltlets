import fs from "node:fs";
import net from "node:net";
import { z } from "zod";
import { writeFileAtomic } from "./fs-safe.js";
import type { RepoLayout } from "../repo-layout.js";
import { getRepoLayout } from "../repo-layout.js";
import type { OpenclawAgents, OpenclawChannels, OpenclawHooks, OpenclawPlugins, OpenclawSkills } from "../generated/openclaw-config.types.js";
import { GatewayIdSchema, HostNameSchema, PersonaNameSchema, SecretNameSchema, SkillIdSchema, assertSafeHostName } from "@clawlets/shared/lib/identifiers";
import { assertNoLegacyEnvSecrets, assertNoLegacyHostKeys } from "./clawlets-config-legacy.js";
import { validateClawdbotConfig } from "./clawdbot-schema-validate.js";
import { SecretEnvSchema, SecretFilesSchema } from "./secret-wiring.js";
import { isValidTargetHost } from "./ssh-remote.js";
import { TtlStringSchema } from "@clawlets/cattle-core/lib/ttl";
import { HcloudLabelsSchema, validateHcloudLabelsAtPath } from "@clawlets/cattle-core/lib/hcloud-labels";
import { DEFAULT_NIX_SUBSTITUTERS, DEFAULT_NIX_TRUSTED_PUBLIC_KEYS } from "./nix-cache.js";
import { HOST_THEME_COLORS, HOST_THEME_DEFAULT_COLOR, HOST_THEME_DEFAULT_EMOJI } from "./host-theme.js";
import { getPinnedOpenclawSchema } from "./openclaw-schema.js";
import { OPENCLAW_DEFAULT_COMMANDS } from "./openclaw-defaults.js";
import { CLAWLETS_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";

export const SSH_EXPOSURE_MODES = ["tailnet", "bootstrap", "public"] as const;
export const SshExposureModeSchema = z.enum(SSH_EXPOSURE_MODES);
export type SshExposureMode = z.infer<typeof SshExposureModeSchema>;

export const TAILNET_MODES = ["none", "tailscale"] as const;
export const TailnetModeSchema = z.enum(TAILNET_MODES);
export type TailnetMode = z.infer<typeof TailnetModeSchema>;
export { CLAWLETS_CONFIG_SCHEMA_VERSION };
export { HOST_THEME_COLORS };
export const HostThemeColorSchema = z.enum(HOST_THEME_COLORS);
export type HostThemeColor = z.infer<typeof HostThemeColorSchema>;

export const GATEWAY_ARCHITECTURES = ["multi", "single"] as const;
export const GatewayArchitectureSchema = z.enum(GATEWAY_ARCHITECTURES);
export type GatewayArchitecture = z.infer<typeof GatewayArchitectureSchema>;

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.any());

type UpstreamChannels = NonNullable<OpenclawChannels>;
type FleetGatewayChannels = Record<string, any> & Pick<UpstreamChannels, "discord" | "telegram">;

type UpstreamAgentsDefaults = NonNullable<NonNullable<OpenclawAgents>["defaults"]>;
type FleetGatewayAgentsDefaults = Record<string, any> & UpstreamAgentsDefaults;

type UpstreamHooks = NonNullable<OpenclawHooks>;
type FleetGatewayHooks = Record<string, any> &
  UpstreamHooks & {
    tokenSecret?: string;
    gmailPushTokenSecret?: string;
  };

type UpstreamSkills = NonNullable<OpenclawSkills>;
type UpstreamSkillEntry = UpstreamSkills extends { entries?: Record<string, infer Entry> } ? Entry : never;
type FleetGatewaySkillEntry = Record<string, any> & UpstreamSkillEntry & { apiKeySecret?: string };
type FleetGatewaySkills = Record<string, any> &
  Omit<UpstreamSkills, "entries"> & {
    entries?: Record<string, FleetGatewaySkillEntry>;
  };

type UpstreamPlugins = NonNullable<OpenclawPlugins>;
type FleetGatewayPlugins = Record<string, any> & UpstreamPlugins;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatPathLabel(segments: Array<string | number>): string {
  let out = "";
  for (const seg of segments) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
      continue;
    }
    out = out ? `${out}.${seg}` : seg;
  }
  return out || "(root)";
}

function stripPathPrefix(message: string): string {
  const idx = message.indexOf(":");
  if (idx === -1) return message.trim();
  return message.slice(idx + 1).trim() || message.trim();
}

function parseCidr(value: string): { ip: string; prefix: number; family: 4 | 6 } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [ip, prefixRaw] = trimmed.split("/");
  if (!ip || !prefixRaw) return null;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix)) return null;
  const family = net.isIP(ip);
  if (family === 4 && prefix >= 0 && prefix <= 32) return { ip, prefix, family: 4 };
  if (family === 6 && prefix >= 0 && prefix <= 128) return { ip, prefix, family: 6 };
  return null;
}

function isWorldOpenCidr(parsed: { ip: string; prefix: number; family: 4 | 6 }): boolean {
  if (parsed.family === 4) return parsed.ip === "0.0.0.0" && parsed.prefix === 0;
  return (parsed.ip === "::" || parsed.ip === "0:0:0:0:0:0:0:0") && parsed.prefix === 0;
}

const FleetGatewayProfileSchema = z
  .object({
    secretEnv: SecretEnvSchema,
    secretFiles: SecretFilesSchema,
  })
  .passthrough()
  .default(() => ({ secretEnv: {}, secretFiles: {} }));

const FleetGatewayChannelsSchema: z.ZodType<FleetGatewayChannels> = z
  .object({
    discord: z
      .object({
        // Matches `clawdbot-config.schema.json` for channels.discord.
        enabled: z.boolean().default(true),
        groupPolicy: z.enum(["open", "disabled", "allowlist"]).default("allowlist"),
      })
      .passthrough()
      .optional(),
    telegram: z
      .object({
        enabled: z.boolean().default(true),
        allowFrom: z.array(z.union([z.string().trim().min(1), z.number()])).default(() => []),
        dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).default("allowlist"),
        groupPolicy: z.enum(["open", "disabled", "allowlist"]).default("allowlist"),
        streamMode: z.enum(["off", "partial", "block"]).default("block"),
        groups: JsonObjectSchema.default(() => ({})),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .default(() => ({}));

const ThinkingDefaultSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

const FleetGatewayAgentsDefaultsSchema: z.ZodType<FleetGatewayAgentsDefaults> = z
  .object({
    model: z
      .object({
        primary: z.string().trim().min(1),
        fallbacks: z.array(z.string().trim().min(1)).default(() => []),
      })
      .passthrough()
      .optional(),
    thinkingDefault: ThinkingDefaultSchema.optional(),
    maxConcurrent: z.number().int().positive().optional(),
  })
  .passthrough()
  .default(() => ({}));

const FleetGatewayAgentEntrySchema = z
  .object({
    id: PersonaNameSchema,
    default: z.boolean().optional(),
    name: z.string().trim().min(1).optional(),
    workspace: z.string().trim().min(1).optional(),
    agentDir: z.string().trim().min(1).optional(),
    model: JsonObjectSchema.optional(),
    sandbox: JsonObjectSchema.optional(),
    tools: JsonObjectSchema.optional(),
  })
  .passthrough();

const FleetGatewayAgentsSchema = z
  .object({
    defaults: FleetGatewayAgentsDefaultsSchema,
    list: z.array(FleetGatewayAgentEntrySchema).default(() => []),
  })
  .superRefine((agents, ctx) => {
    const list = agents.list || [];
    const seen = new Set<string>();
    let defaultCount = 0;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry?.id) continue;
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["list", i, "id"],
          message: `duplicate agent id: ${entry.id}`,
        });
      }
      seen.add(entry.id);
      if (entry.default) defaultCount += 1;
    }
    if (defaultCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["list"],
        message: "agents.list may contain at most one default agent",
      });
    }
  })
  .passthrough()
  .default(() => ({ defaults: {}, list: [] }));

const FleetGatewayHooksSchema: z.ZodType<FleetGatewayHooks> = z
  .object({
    enabled: z.boolean().optional(),
    token: z.string().trim().min(1).optional(),
    tokenSecret: SecretNameSchema.optional(),
    gmailPushTokenSecret: SecretNameSchema.optional(),
    gmail: JsonObjectSchema.optional(),
  })
  .passthrough()
  .default(() => ({}));

const FleetGatewaySkillEntrySchema: z.ZodType<FleetGatewaySkillEntry> = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().trim().min(1).optional(),
    apiKeySecret: SecretNameSchema.optional(),
    env: JsonObjectSchema.optional(),
    config: JsonObjectSchema.optional(),
  })
  .passthrough()
  .default(() => ({}));

const FleetGatewaySkillsSchema: z.ZodType<FleetGatewaySkills> = z
  .object({
    allowBundled: z.array(SkillIdSchema).optional(),
    load: z
      .object({
        extraDirs: z.array(z.string().trim().min(1)).optional(),
      })
      .passthrough()
      .optional(),
    entries: z.record(SkillIdSchema, FleetGatewaySkillEntrySchema).optional(),
  })
  .passthrough()
  .default(() => ({}));

const FleetGatewayPluginsSchema: z.ZodType<FleetGatewayPlugins> = z
  .object({
    enabled: z.boolean().optional(),
    allow: z.array(z.string().trim().min(1)).optional(),
    deny: z.array(z.string().trim().min(1)).optional(),
    load: z
      .object({
        paths: z.array(z.string().trim().min(1)).optional(),
      })
      .passthrough()
      .optional(),
    entries: JsonObjectSchema.optional(),
  })
  .passthrough()
  .default(() => ({}));

const FleetGatewaySchema = z
  .object({
    profile: FleetGatewayProfileSchema,
    channels: FleetGatewayChannelsSchema,
    agents: FleetGatewayAgentsSchema,
    hooks: FleetGatewayHooksSchema,
    skills: FleetGatewaySkillsSchema,
    plugins: FleetGatewayPluginsSchema,
    openclaw: JsonObjectSchema.default(() => ({})),
    clf: JsonObjectSchema.default(() => ({})),
  })
  .superRefine((gateway, ctx) => {
    // Hard reject legacy clawdbot key - no backwards compatibility.
    if ((gateway as any).clawdbot !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clawdbot"],
        message:
          "The 'clawdbot' key has been renamed to 'openclaw'. Please update hosts.<host>.gateways.<gatewayId>.clawdbot to hosts.<host>.gateways.<gatewayId>.openclaw.",
      });
    }

    // No backwards-compat: typed surfaces must not be set under hosts.<host>.gateways.<gatewayId>.openclaw.*.
    const legacy = gateway.openclaw as any;
    const rejectLegacy = (key: string) => {
      if (legacy?.[key] === undefined) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openclaw", key],
        message: `Do not set hosts.<host>.gateways.<gatewayId>.openclaw.${key}; use hosts.<host>.gateways.<gatewayId>.${key} instead.`,
      });
    };
    rejectLegacy("channels");
    rejectLegacy("agents");
    rejectLegacy("hooks");
    rejectLegacy("skills");
    rejectLegacy("plugins");

    const profile = gateway.profile as any;
    if (profile?.hooks !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "hooks"],
        message: "Do not set hosts.<host>.gateways.<gatewayId>.profile.hooks; use hosts.<host>.gateways.<gatewayId>.hooks instead.",
      });
    }
    if (profile?.skills !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "skills"],
        message: "Do not set hosts.<host>.gateways.<gatewayId>.profile.skills; use hosts.<host>.gateways.<gatewayId>.skills instead.",
      });
    }
  })
  .passthrough()
  .default(() => ({
    profile: { secretEnv: {}, secretFiles: {} },
    channels: {},
    agents: { defaults: {}, list: [] },
    hooks: {},
    skills: {},
    plugins: {},
    openclaw: {},
    clf: {},
  }));

const FleetSchema = z
  .object({
    secretEnv: SecretEnvSchema,
    secretFiles: SecretFilesSchema,
    sshAuthorizedKeys: z.array(z.string().trim().min(1)).default(() => []),
    sshKnownHosts: z.array(z.string().trim().min(1)).default(() => []),
    gatewayArchitecture: GatewayArchitectureSchema.optional(),
    codex: z
      .object({
        enable: z.boolean().default(false),
        gateways: z.array(GatewayIdSchema).default(() => []),
      })
      .default(() => ({ enable: false, gateways: [] }))
      .superRefine((codex, ctx) => {
        if ((codex as any).bots !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bots"],
            message: "fleet.codex.bots was removed; use fleet.codex.gateways",
          });
        }
      }),
    backups: z
      .object({
        restic: z
          .object({
            enable: z.boolean().default(false),
            repository: z.string().trim().default(""),
          })
          .default(() => ({ enable: false, repository: "" })),
      })
      .default(() => ({ restic: { enable: false, repository: "" } })),
  })
  .passthrough()
  .superRefine((fleet, ctx) => {
    if ((fleet as any).gatewayOrder !== undefined || (fleet as any).gateways !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "fleet.gateways and fleet.gatewayOrder were removed; use hosts.<host>.gateways and hosts.<host>.gatewaysOrder",
      });
      return;
    }
    if ((fleet as any).botOrder !== undefined || (fleet as any).bots !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "fleet.bots and fleet.botOrder were removed; use hosts.<host>.gateways and hosts.<host>.gatewaysOrder",
      });
      return;
    }
  });

const HostSchema = z
  .object({
    enable: z.boolean().default(false),
    gatewaysOrder: z.array(GatewayIdSchema).default(() => []),
    gateways: z.record(GatewayIdSchema, FleetGatewaySchema).default(() => ({})),
    openclaw: z
      .object({
        enable: z.boolean().default(false),
      })
      .default(() => ({ enable: false })),
    diskDevice: z.string().trim().default("/dev/sda"),
    flakeHost: z.string().trim().default(""),
    targetHost: z
      .string()
      .trim()
      .min(1)
      .optional()
      .refine((v) => (v ? isValidTargetHost(v) : true), {
        message: "invalid targetHost (expected ssh alias or user@host)",
      }),
    theme: z
      .object({
        emoji: z.string().trim().min(1).default(HOST_THEME_DEFAULT_EMOJI),
        color: HostThemeColorSchema.default(HOST_THEME_DEFAULT_COLOR),
      })
      .default(() => ({ emoji: HOST_THEME_DEFAULT_EMOJI, color: HOST_THEME_DEFAULT_COLOR })),
    hetzner: z
      .object({
        serverType: z.string().trim().min(1).default("cx43"),
        image: z.string().trim().default(""),
        location: z.string().trim().default("nbg1"),
      })
      .default(() => ({ serverType: "cx43", image: "", location: "nbg1" })),
    provisioning: z
      .object({
        adminCidr: z.string().trim().default(""),
        adminCidrAllowWorldOpen: z.boolean().default(false),
        // Local path on the operator machine that runs provisioning.
        // Intentionally default empty to avoid silently persisting a guessed path in shared config.
        sshPubkeyFile: z.string().trim().default(""),
      })
      .superRefine((value, ctx) => {
        const adminCidr = value.adminCidr.trim();
        if (!adminCidr) return;
        const parsed = parseCidr(adminCidr);
        if (!parsed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "provisioning.adminCidr must be a valid CIDR (e.g. 203.0.113.10/32)",
            path: ["adminCidr"],
          });
          return;
        }
        if (isWorldOpenCidr(parsed) && !value.adminCidrAllowWorldOpen) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "provisioning.adminCidr cannot be world-open unless adminCidrAllowWorldOpen is true",
            path: ["adminCidr"],
          });
        }
      })
      .default(() => ({ adminCidr: "", adminCidrAllowWorldOpen: false, sshPubkeyFile: "" })),
    sshExposure: z
      .object({
        mode: SshExposureModeSchema.default("bootstrap"),
      })
      .default(() => ({ mode: "bootstrap" as const })),
    tailnet: z
      .object({
        mode: TailnetModeSchema.default("tailscale"),
      })
      .default(() => ({ mode: "tailscale" as const })),
    cache: z
      .object({
        substituters: z
          .array(z.string().trim().min(1))
          .min(1, { message: "cache.substituters must not be empty" })
          .default(() => Array.from(DEFAULT_NIX_SUBSTITUTERS)),
        trustedPublicKeys: z
          .array(z.string().trim().min(1))
          .min(1, { message: "cache.trustedPublicKeys must not be empty" })
          .default(() => Array.from(DEFAULT_NIX_TRUSTED_PUBLIC_KEYS)),
        netrc: z
          .object({
            enable: z.boolean().default(false),
            secretName: SecretNameSchema.default("garnix_netrc"),
            path: z.string().trim().default("/etc/nix/netrc"),
            narinfoCachePositiveTtl: z.number().int().positive().default(3600),
          })
          .default(() => ({
            enable: false,
            secretName: "garnix_netrc",
            path: "/etc/nix/netrc",
            narinfoCachePositiveTtl: 3600,
          })),
      })
      .superRefine((cache, ctx) => {
        if (cache.netrc.enable && !cache.netrc.secretName.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["netrc", "secretName"],
            message: "cache.netrc.secretName must be set when cache.netrc.enable is true",
          });
        }
        if (cache.netrc.enable && !cache.netrc.path.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["netrc", "path"],
            message: "cache.netrc.path must be set when cache.netrc.enable is true",
          });
        }
      })
      .default(() => ({
        substituters: Array.from(DEFAULT_NIX_SUBSTITUTERS),
        trustedPublicKeys: Array.from(DEFAULT_NIX_TRUSTED_PUBLIC_KEYS),
        netrc: {
          enable: false,
          secretName: "garnix_netrc",
          path: "/etc/nix/netrc",
          narinfoCachePositiveTtl: 3600,
        },
      })),
    operator: z
      .object({
        deploy: z
          .object({
            enable: z.boolean().default(false),
          })
          .default(() => ({ enable: false })),
      })
      .default(() => ({ deploy: { enable: false } })),
    selfUpdate: z
      .object({
        enable: z.boolean().default(false),
        interval: z.string().trim().default("30min"),
        baseUrls: z.array(z.string().trim().min(1)).default([]),
        channel: z
          .string()
          .trim()
          .default("prod")
          .refine((v) => /^[a-z][a-z0-9-]*$/.test(v), { message: "invalid selfUpdate.channel (use [a-z][a-z0-9-]*)" }),
        publicKeys: z.array(z.string().trim().min(1)).default([]),
        previousPublicKeys: z.array(z.string().trim().min(1)).default([]),
        previousPublicKeysValidUntil: z.string().trim().default(""),
        allowUnsigned: z.boolean().default(false),
        allowRollback: z.boolean().default(false),
        healthCheckUnit: z.string().trim().default(""),
      })
      .superRefine((v, ctx) => {
        if (v.enable && v.baseUrls.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["baseUrls"],
            message: "selfUpdate.baseUrls must be set when enabled",
          });
        }
        if (v.enable && !v.allowUnsigned && v.publicKeys.length === 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["publicKeys"], message: "selfUpdate.publicKeys must be set when enabled (or enable allowUnsigned for dev)" });
        }
        if (v.previousPublicKeys.length > 0 && !v.previousPublicKeysValidUntil) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["previousPublicKeysValidUntil"],
            message: "selfUpdate.previousPublicKeysValidUntil is required when previousPublicKeys is set",
          });
        }
        if (v.previousPublicKeysValidUntil && v.previousPublicKeys.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["previousPublicKeys"],
            message: "selfUpdate.previousPublicKeys is required when previousPublicKeysValidUntil is set",
          });
        }
        if (v.previousPublicKeysValidUntil && Number.isNaN(Date.parse(v.previousPublicKeysValidUntil))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["previousPublicKeysValidUntil"],
            message: "invalid selfUpdate.previousPublicKeysValidUntil (expected ISO timestamp)",
          });
        }
        const allKeys = new Set([...v.publicKeys, ...v.previousPublicKeys]);
        if (allKeys.size !== v.publicKeys.length + v.previousPublicKeys.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["previousPublicKeys"],
            message: "selfUpdate.previousPublicKeys must not overlap selfUpdate.publicKeys",
          });
        }
        if (v.healthCheckUnit && !/^[A-Za-z0-9@._:-]+(\.service)?$/.test(v.healthCheckUnit)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["healthCheckUnit"], message: "invalid selfUpdate.healthCheckUnit" });
        }
      })
      .default(() => ({
        enable: false,
        interval: "30min",
        baseUrls: [],
        channel: "prod",
        publicKeys: [],
        previousPublicKeys: [],
        previousPublicKeysValidUntil: "",
        allowUnsigned: false,
        allowRollback: false,
        healthCheckUnit: "",
      })),
    agentModelPrimary: z.string().trim().default("anthropic/claude-opus-4-5"),
  })
  .superRefine((host, ctx) => {
    const gatewayIds = Object.keys(host.gateways || {});
    const gatewaysOrder = host.gatewaysOrder || [];
    const seen = new Set<string>();
    for (let i = 0; i < gatewaysOrder.length; i++) {
      const id = gatewaysOrder[i]!;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gatewaysOrder", i],
          message: `duplicate gateway id: ${id}`,
        });
        continue;
      }
      seen.add(id);
      if (!host.gateways[id]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gatewaysOrder", i],
          message: `unknown gateway id: ${id}`,
        });
      }
    }

    if (gatewayIds.length > 0 && gatewaysOrder.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gatewaysOrder"],
        message: "gatewaysOrder must be set (deterministic order for ports/services)",
      });
      return;
    }

    const missing = gatewayIds.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gatewaysOrder"],
        message: `gatewaysOrder missing gateways: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` (+${missing.length - 6})` : ""}`,
      });
    }

    if (host.openclaw?.enable && gatewayIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openclaw", "enable"],
        message: "openclaw.enable requires at least one gateway",
      });
    }
  });

const CattleSchema = z
  .object({
    enabled: z.boolean().default(false),
    hetzner: z
      .object({
        image: z.string().trim().default(""),
        serverType: z.string().trim().min(1).default("cx22"),
        location: z.string().trim().min(1).default("nbg1"),
        maxInstances: z.number().int().positive().default(10),
        defaultTtl: TtlStringSchema.default("2h"),
        labels: HcloudLabelsSchema.default(() => ({ "managed-by": "clawlets" })),
      })
      .default(() => ({
        image: "",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labels: { "managed-by": "clawlets" },
      })),
    defaults: z
      .object({
        autoShutdown: z.boolean().default(true),
        callbackUrl: z.string().trim().default(""),
      })
      .default(() => ({ autoShutdown: true, callbackUrl: "" })),
  })
  .default(() => ({
    enabled: false,
    hetzner: {
      image: "",
      serverType: "cx22",
      location: "nbg1",
      maxInstances: 10,
      defaultTtl: "2h",
      labels: { "managed-by": "clawlets" },
    },
    defaults: { autoShutdown: true, callbackUrl: "" },
  }));

export const ClawletsConfigSchema = z.object({
  schemaVersion: z.literal(CLAWLETS_CONFIG_SCHEMA_VERSION),
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
  hosts: z.record(HostNameSchema, HostSchema).refine((v) => Object.keys(v).length > 0, {
    message: "hosts must not be empty",
  }),
}).superRefine((cfg, ctx) => {
  if (cfg.defaultHost && !cfg.hosts[cfg.defaultHost]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultHost"],
      message: `defaultHost not found in hosts: ${cfg.defaultHost}`,
    });
  }

  validateHcloudLabelsAtPath({
    value: (cfg as any).cattle?.hetzner?.labels,
    ctx,
    path: ["cattle", "hetzner", "labels"],
  });

  const cattleEnabled = Boolean((cfg as any).cattle?.enabled);
  const cattleImage = String((cfg as any).cattle?.hetzner?.image || "").trim();
  if (cattleEnabled && !cattleImage) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cattle", "hetzner", "image"],
      message: "cattle.hetzner.image must be set when cattle.enabled is true",
    });
  }

  const schema = getPinnedOpenclawSchema().schema as Record<string, unknown>;
  for (const [hostName, hostCfg] of Object.entries(cfg.hosts || {})) {
    const gateways = (hostCfg as any)?.gateways;
    const gatewaysOrder = Array.isArray((hostCfg as any)?.gatewaysOrder) ? ((hostCfg as any).gatewaysOrder as string[]) : [];
    const ids = gatewaysOrder.length > 0 ? gatewaysOrder : Object.keys(gateways || {});
    for (const gatewayId of ids) {
      const gatewayCfg = (gateways as any)?.[gatewayId];
      const openclaw = (gatewayCfg as any)?.openclaw;
      if (!isPlainObject(openclaw)) continue;

      // Legacy typed surfaces are rejected earlier; avoid spamming schema errors.
      const legacyKeys = ["channels", "agents", "hooks", "skills", "plugins"] as const;
      if (legacyKeys.some((k) => (openclaw as any)?.[k] !== undefined)) continue;

      const openclawForValidation = structuredClone(openclaw) as Record<string, unknown>;
      const commands = openclawForValidation["commands"];
      if (commands === undefined) {
        openclawForValidation["commands"] = OPENCLAW_DEFAULT_COMMANDS;
      } else if (isPlainObject(commands)) {
        openclawForValidation["commands"] = { ...OPENCLAW_DEFAULT_COMMANDS, ...commands };
      }

      const validation = validateClawdbotConfig(openclawForValidation, schema);
      if (validation.ok) continue;
      for (const issue of validation.issues) {
        const path = ["hosts", hostName, "gateways", gatewayId, "openclaw", ...issue.path];
        const message = `${formatPathLabel(path)}: ${stripPathPrefix(issue.message)}`;
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      }
    }
  }
});

export type ClawletsConfig = z.infer<typeof ClawletsConfigSchema>;
export type ClawletsHostConfig = z.infer<typeof HostSchema>;

export const SafeHostNameSchema = HostNameSchema;
export { assertSafeHostName };

export function getSshExposureMode(hostCfg: ClawletsHostConfig | null | undefined): SshExposureMode {
  const mode = hostCfg?.sshExposure?.mode;
  if (mode === "bootstrap" || mode === "public" || mode === "tailnet") return mode;
  return "tailnet";
}

export function isPublicSshExposure(mode: SshExposureMode): boolean {
  return mode === "bootstrap" || mode === "public";
}

export function getTailnetMode(hostCfg: ClawletsHostConfig | null | undefined): TailnetMode {
  const mode = hostCfg?.tailnet?.mode;
  if (mode === "tailscale" || mode === "none") return mode;
  return "none";
}

export function createDefaultClawletsConfig(params: { host: string; gateways?: string[] }): ClawletsConfig {
  const host = params.host.trim() || "openclaw-fleet-host";
  const gateways = (params.gateways || ["maren", "sonja", "gunnar", "melinda"]).map((id) => id.trim()).filter(Boolean);
  const gatewaysRecord = Object.fromEntries(gateways.map((id) => [id, {}]));
  return ClawletsConfigSchema.parse({
    schemaVersion: CLAWLETS_CONFIG_SCHEMA_VERSION,
    defaultHost: host,
    baseFlake: "",
    fleet: {
      secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
      secretFiles: {},
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      codex: { enable: false, gateways: [] },
      backups: { restic: { enable: false, repository: "" } },
    },
    cattle: {
      enabled: false,
      hetzner: {
        image: "",
        serverType: "cx22",
        location: "nbg1",
        maxInstances: 10,
        defaultTtl: "2h",
        labels: { "managed-by": "clawlets" },
      },
      defaults: { autoShutdown: true, callbackUrl: "" },
    },
    hosts: {
      [host]: {
        enable: false,
        gatewaysOrder: gateways,
        gateways: gatewaysRecord,
        openclaw: { enable: false },
        diskDevice: "/dev/sda",
        flakeHost: "",
        hetzner: { serverType: "cx43", image: "", location: "nbg1" },
        provisioning: { adminCidr: "", adminCidrAllowWorldOpen: false, sshPubkeyFile: "" },
        sshExposure: { mode: "bootstrap" },
        tailnet: { mode: "tailscale" },
        cache: {
          substituters: Array.from(DEFAULT_NIX_SUBSTITUTERS),
          trustedPublicKeys: Array.from(DEFAULT_NIX_TRUSTED_PUBLIC_KEYS),
          netrc: {
            enable: false,
            secretName: "garnix_netrc",
            path: "/etc/nix/netrc",
            narinfoCachePositiveTtl: 3600,
          },
        },
        operator: { deploy: { enable: false } },
        selfUpdate: {
          enable: false,
          interval: "30min",
          baseUrls: [],
          channel: "prod",
          publicKeys: [],
          previousPublicKeys: [],
          previousPublicKeysValidUntil: "",
          allowUnsigned: false,
          allowRollback: false,
          healthCheckUnit: "",
        },
        agentModelPrimary: "zai/glm-4.7",
      },
    },
  });
}

export type ResolveHostNameResult =
  | { ok: true; host: string; source: "flag" | "defaultHost" | "soleHost" }
  | { ok: false; message: string; tips: string[]; availableHosts: string[] };

export function resolveHostName(params: { config: ClawletsConfig; host?: unknown }): ResolveHostNameResult {
  const availableHosts = Object.keys(params.config.hosts || {});
  const provided = String(params.host ?? "").trim();

  if (provided) {
    try {
      assertSafeHostName(provided);
    } catch (e) {
      return {
        ok: false,
        message: String((e as Error)?.message || e),
        availableHosts,
        tips: [
          "host names must be safe identifiers (no spaces or shell metacharacters)",
          availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
          `use --host <name> to select a host`,
        ],
      };
    }
    if (params.config.hosts[provided]) {
      return { ok: true, host: provided, source: "flag" };
    }
    return {
      ok: false,
      message: `unknown host: ${provided}`,
      availableHosts,
      tips: [
        availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
        `use --host <name> to select a host`,
        `set defaultHost via: clawlets host set-default --host <name>`,
      ],
    };
  }

  if (params.config.defaultHost) {
    return { ok: true, host: params.config.defaultHost, source: "defaultHost" };
  }

  if (availableHosts.length === 1) {
    return { ok: true, host: availableHosts[0]!, source: "soleHost" };
  }

  return {
    ok: false,
    message: "missing host (multiple hosts configured)",
    availableHosts,
    tips: [
      `pass --host <name>`,
      `set defaultHost via: clawlets host set-default --host <name>`,
      availableHosts.length > 0 ? `available hosts: ${availableHosts.join(", ")}` : "available hosts: (none)",
    ],
  };
}

export function loadClawletsConfigRaw(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: unknown;
} {
  const layout = getRepoLayout(params.repoRoot, params.runtimeDir);
  const configPath = layout.clawletsConfigPath;
  if (!fs.existsSync(configPath)) throw new Error(`missing clawlets config: ${configPath}`);
  const raw = fs.readFileSync(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON: ${configPath}`);
  }
  assertNoLegacyHostKeys(parsed);
  assertNoLegacyEnvSecrets(parsed);
  return { layout, configPath, config: parsed };
}

export function loadClawletsConfig(params: { repoRoot: string; runtimeDir?: string }): {
  layout: RepoLayout;
  configPath: string;
  config: ClawletsConfig;
} {
  const { layout, configPath, config: raw } = loadClawletsConfigRaw(params);
  const config = ClawletsConfigSchema.parse(raw);
  return { layout, configPath, config };
}

export async function writeClawletsConfig(params: { configPath: string; config: ClawletsConfig }): Promise<void> {
  await writeFileAtomic(params.configPath, `${JSON.stringify(params.config, null, 2)}\n`);
}
