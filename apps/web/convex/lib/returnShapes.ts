import type { Infer } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { ProjectDoc } from "./validators";

export type ProjectDocValue = Infer<typeof ProjectDoc>;

// Convex docs frequently omit optional fields entirely. For return validators and
// API types, it's helpful to avoid returning `{ field: undefined }` and instead
// omit the key when absent.
export function toProjectDocValue(project: Doc<"projects">): ProjectDocValue {
  const { localPath, lastSeenAt, ...rest } = project;
  return {
    ...rest,
    ...(typeof localPath === "string" ? { localPath } : {}),
    ...(typeof lastSeenAt === "number" ? { lastSeenAt } : {}),
  };
}

