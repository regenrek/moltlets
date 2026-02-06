import { z } from "zod";
import schemaArtifact from "../../../generated/openclaw-config.schema.json" with { type: "json" };

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
  openclawRev: z.string().min(1),
}).passthrough();

export const OpenclawSchemaArtifactSchema = RawOpenclawSchemaArtifactSchema.transform((value): OpenclawSchemaArtifact => {
  return {
    schema: value.schema,
    uiHints: value.uiHints,
    version: value.version,
    generatedAt: value.generatedAt || value.openclawRev,
    openclawRev: value.openclawRev,
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
  const parsed = parseOpenclawSchemaArtifact(schemaArtifact);
  if (!parsed.ok) throw new Error(`invalid pinned openclaw schema: ${parsed.error}`);
  cachedPinnedSchema = parsed.value;
  return cachedPinnedSchema;
}
