import { z } from "zod";
import { getPinnedOpenclawSchema } from "./openclaw-schema.js";

export type ClawdbotSchemaArtifact = {
  schema: Record<string, any>;
  uiHints: Record<string, any>;
  version: string;
  generatedAt: string;
  clawdbotRev: string;
};

const ClawdbotSchemaArtifactObject = z.object({}).catchall(z.any());

export const ClawdbotSchemaArtifactSchema = z.object({
  schema: ClawdbotSchemaArtifactObject,
  uiHints: ClawdbotSchemaArtifactObject,
  version: z.string().min(1),
  generatedAt: z.string().min(1),
  clawdbotRev: z.string().min(1),
});

export function parseClawdbotSchemaArtifact(input: unknown):
  | { ok: true; value: ClawdbotSchemaArtifact }
  | { ok: false; error: string } {
  const parsed = ClawdbotSchemaArtifactSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as ClawdbotSchemaArtifact };
  return { ok: false, error: "schema payload missing required fields" };
}

let cachedPinnedSchema: ClawdbotSchemaArtifact | null = null;

export function getPinnedClawdbotSchema(): ClawdbotSchemaArtifact {
  if (cachedPinnedSchema) return cachedPinnedSchema;
  const pinned = getPinnedOpenclawSchema();
  cachedPinnedSchema = {
    schema: pinned.schema,
    uiHints: pinned.uiHints,
    version: pinned.version,
    generatedAt: pinned.openclawRev,
    clawdbotRev: pinned.openclawRev,
  };
  return cachedPinnedSchema;
}
