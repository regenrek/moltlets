import { z } from "zod";
import { GatewayIdSchema, HostNameSchema } from "@clawlets/shared/lib/identifiers";
import { OPENCLAW_CONFIG_SCHEMA_VERSION } from "./clawlets-config-version.js";
import { FleetGatewaySchema } from "./schema-gateway.js";
import { GATEWAY_ARCHITECTURES, GatewayArchitectureSchema } from "./schema-fleet.js";
import { SecretEnvSchema, SecretFilesSchema } from "../secrets/secret-wiring.js";
import { addOpenclawSchemaIssues } from "./openclaw-validation.js";

export const OpenClawHostConfigSchema = z
  .object({
    enable: z.boolean().default(false),
    agentModelPrimary: z.string().trim().default("anthropic/claude-opus-4-5"),
    gatewaysOrder: z.array(GatewayIdSchema).default(() => []),
    gateways: z.record(GatewayIdSchema, FleetGatewaySchema).default(() => ({})),
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

    if (host.enable && gatewayIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enable"],
        message: "enable requires at least one gateway",
      });
    }
  });

export const OpenClawFleetConfigSchema = z
  .object({
    secretEnv: SecretEnvSchema,
    secretFiles: SecretFilesSchema,
    gatewayArchitecture: GatewayArchitectureSchema.default(GATEWAY_ARCHITECTURES[0]),
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
  })
  .default(() => ({
    secretEnv: {},
    secretFiles: {},
    gatewayArchitecture: GATEWAY_ARCHITECTURES[0],
    codex: { enable: false, gateways: [] },
  }));

export const OpenClawConfigSchema = z
  .object({
    schemaVersion: z.literal(OPENCLAW_CONFIG_SCHEMA_VERSION),
    hosts: z.record(HostNameSchema, OpenClawHostConfigSchema).default(() => ({})),
    fleet: OpenClawFleetConfigSchema,
  })
  .superRefine((cfg, ctx) => {
    addOpenclawSchemaIssues({ config: cfg, ctx });
  });

export type OpenClawHostConfig = z.infer<typeof OpenClawHostConfigSchema>;
export type OpenClawFleetConfig = z.infer<typeof OpenClawFleetConfigSchema>;
export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;
