import { z } from "zod";
import type { OpenclawAgents, OpenclawChannels, OpenclawHooks, OpenclawPlugins, OpenclawSkills } from "../../generated/openclaw-config.types.js";
import { PersonaNameSchema, SecretNameSchema, SkillIdSchema } from "@clawlets/shared/lib/identifiers";
import { SecretEnvSchema, SecretFilesSchema } from "../secrets/secret-wiring.js";

const JsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.any());
const LEGACY_GATEWAY_KEY = ["claw", "dbot"].join("");

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
        // Matches `openclaw-config.schema.json` for channels.discord.
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

export const FleetGatewaySchema = z
  .object({
    profile: FleetGatewayProfileSchema,
    channels: FleetGatewayChannelsSchema,
    agents: FleetGatewayAgentsSchema,
    hooks: FleetGatewayHooksSchema,
    skills: FleetGatewaySkillsSchema,
    plugins: FleetGatewayPluginsSchema,
    openclaw: JsonObjectSchema.default(() => ({})),
    clf: z.never().optional(),
  })
  .superRefine((gateway, ctx) => {
    // Hard reject legacy gateway key - no backwards compatibility.
    if ((gateway as Record<string, unknown>)[LEGACY_GATEWAY_KEY] !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [LEGACY_GATEWAY_KEY],
        message:
          "Legacy gateway key detected. Use hosts.<host>.gateways.<gatewayId>.openclaw for raw OpenClaw config.",
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
  }));
