import { z } from "zod";
import { HostNameSchema, SecretNameSchema } from "@clawlets/shared/lib/identifiers";
import { INFRA_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";
import { SecretEnvSchema, SecretFilesSchema } from "../secrets/secret-wiring.js";
import { CattleSchema } from "./schema-cattle.js";
import { isValidTargetHost } from "../security/ssh-remote.js";
import { HOST_THEME_COLORS, HOST_THEME_DEFAULT_COLOR, HOST_THEME_DEFAULT_EMOJI } from "../host/host-theme.js";
import { DEFAULT_NIX_SUBSTITUTERS, DEFAULT_NIX_TRUSTED_PUBLIC_KEYS } from "../nix/nix-cache.js";
import { parseCidr, isWorldOpenCidr } from "./helpers.js";
import { AwsHostSchema, HetznerHostSchema, ProvisioningProviderSchema, addProvisioningIssues } from "./providers/index.js";

export const InfraFleetSchema = z.object({
  secretEnv: SecretEnvSchema,
  secretFiles: SecretFilesSchema,
  sshAuthorizedKeys: z.array(z.string().trim().min(1)).default(() => []),
  sshKnownHosts: z.array(z.string().trim().min(1)).default(() => []),
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
});

const HostThemeColorSchema = z.enum(HOST_THEME_COLORS);
const SshExposureModeSchema = z.enum(["tailnet", "bootstrap", "public"]);
const TailnetModeSchema = z.enum(["none", "tailscale"]);

export const InfraHostConfigSchema = z
  .object({
    enable: z.boolean().default(false),
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
    hetzner: HetznerHostSchema,
    aws: AwsHostSchema,
    provisioning: z
      .object({
        provider: ProvisioningProviderSchema.default("hetzner"),
        adminCidr: z.string().trim().default(""),
        adminCidrAllowWorldOpen: z.boolean().default(false),
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
      .default(() => ({
        provider: "hetzner" as const,
        adminCidr: "",
        adminCidrAllowWorldOpen: false,
        sshPubkeyFile: "",
      })),
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
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["publicKeys"],
            message: "selfUpdate.publicKeys must be set when enabled",
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
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["healthCheckUnit"],
            message: "invalid selfUpdate.healthCheckUnit",
          });
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
  })
  .superRefine((host, ctx) => {
    addProvisioningIssues({ host, ctx });
  });

export const InfraConfigSchema = z
  .object({
    schemaVersion: z.literal(INFRA_CONFIG_SCHEMA_VERSION),
    defaultHost: HostNameSchema.optional(),
    baseFlake: z.string().trim().default(""),
    fleet: InfraFleetSchema.default(() => ({
      secretEnv: {},
      secretFiles: {},
      sshAuthorizedKeys: [],
      sshKnownHosts: [],
      backups: { restic: { enable: false, repository: "" } },
    })),
    cattle: CattleSchema,
    hosts: z.record(HostNameSchema, InfraHostConfigSchema).refine((value) => Object.keys(value).length > 0, {
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
  });

export type InfraFleetConfig = z.infer<typeof InfraFleetSchema>;
export type InfraHostConfig = z.infer<typeof InfraHostConfigSchema>;
export type InfraConfig = z.infer<typeof InfraConfigSchema>;
