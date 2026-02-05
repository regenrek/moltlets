import { z } from "zod";
import { getPinnedOpenclawSchema } from "../../openclaw-schema.js";

export type OpenclawSchemaArtifact = {
  schema: Record<string, any>;
  uiHints: Record<string, any>;
  version: string;
  generatedAt: string;
  openclawRev: string;
};

const OpenclawSchemaArtifactObject = z.object({}).catchall(z.any());

const RawOpenclawSchemaArtifactSchema = z.object({
  schema: OpenclawSchemaArtifactObject,
  uiHints: OpenclawSchemaArtifactObject,
  version: z.string().min(1),
  generatedAt: z.string().min(1).optional(),
  openclawRev: z.string().min(1).optional(),
  clawdbotRev: z.string().min(1).optional(),
});

export const OpenclawSchemaArtifactSchema = RawOpenclawSchemaArtifactSchema.transform((value, ctx): OpenclawSchemaArtifact => {
  const openclawRev = value.openclawRev || value.clawdbotRev || "";
  if (!openclawRev) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "openclawRev is required",
      path: ["openclawRev"],
    });
  }
  return {
    schema: value.schema,
    uiHints: value.uiHints,
    version: value.version,
    generatedAt: value.generatedAt || openclawRev,
    openclawRev,
  };
});

export function parseOpenclawSchemaArtifact(input: unknown):
  | { ok: true; value: OpenclawSchemaArtifact }
  | { ok: false; error: string } {
  const parsed = OpenclawSchemaArtifactSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: "schema payload missing required fields" };
}

let cachedPinnedSchema: OpenclawSchemaArtifact | null = null;

export function getPinnedOpenclawSchemaArtifact(): OpenclawSchemaArtifact {
  if (cachedPinnedSchema) return cachedPinnedSchema;
  const pinned = getPinnedOpenclawSchema();
  cachedPinnedSchema = {
    schema: pinned.schema,
    uiHints: pinned.uiHints,
    version: pinned.version,
    generatedAt: pinned.openclawRev,
    openclawRev: pinned.openclawRev,
  };
  return cachedPinnedSchema;
}
