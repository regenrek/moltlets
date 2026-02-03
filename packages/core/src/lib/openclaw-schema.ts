import schemaArtifact from "../generated/openclaw-config.schema.json" with { type: "json" };
import { z } from "zod";

export type OpenclawSchemaArtifact = {
  schema: Record<string, any>;
  uiHints: Record<string, any>;
  version: string;
  openclawRev: string;
};

const OpenclawSchemaArtifactObject = z.object({}).catchall(z.any());

export const OpenclawSchemaArtifactSchema = z.object({
  schema: OpenclawSchemaArtifactObject,
  uiHints: OpenclawSchemaArtifactObject,
  version: z.string().min(1),
  openclawRev: z.string().min(1),
});

export function parseOpenclawSchemaArtifact(input: unknown):
  | { ok: true; value: OpenclawSchemaArtifact }
  | { ok: false; error: string } {
  const parsed = OpenclawSchemaArtifactSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as OpenclawSchemaArtifact };
  return { ok: false, error: "schema payload missing required fields" };
}

let cachedPinnedSchema: OpenclawSchemaArtifact | null = null;

export function getPinnedOpenclawSchema(): OpenclawSchemaArtifact {
  if (cachedPinnedSchema) return cachedPinnedSchema;
  const parsed = parseOpenclawSchemaArtifact(schemaArtifact);
  if (!parsed.ok) throw new Error(`invalid pinned openclaw schema: ${parsed.error}`);
  cachedPinnedSchema = parsed.value;
  return cachedPinnedSchema;
}

