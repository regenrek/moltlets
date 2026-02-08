import { z } from "zod";
import { TtlStringSchema } from "./ttl.js";
import { HcloudLabelsSchema, validateHcloudLabelsAtPath } from "./hcloud-labels.js";

export const CattleSchema = z
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
  .superRefine((cattle, ctx) => {
    validateHcloudLabelsAtPath({
      value: cattle.hetzner?.labels,
      ctx,
      path: ["hetzner", "labels"],
    });

    if (cattle.enabled && !cattle.hetzner.image.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hetzner", "image"],
        message: "cattle.hetzner.image must be set when cattle.enabled is true",
      });
    }
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

export type ClawletsCattleConfig = z.infer<typeof CattleSchema>;
