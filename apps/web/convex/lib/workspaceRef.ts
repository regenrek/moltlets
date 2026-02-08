import { fail } from "./errors";

export type WorkspaceRefValue = {
  kind: "local" | "git";
  id: string;
  relPath?: string;
};

export function normalizeWorkspaceRef(value: WorkspaceRefValue): WorkspaceRefValue & { key: string } {
  const id = value.id.trim();
  if (!id) fail("conflict", "workspaceRef.id required");
  if (id.length > 128) fail("conflict", "workspaceRef.id too long");
  const relPathRaw = typeof value.relPath === "string" ? value.relPath.trim() : "";
  if (relPathRaw.length > 256) fail("conflict", "workspaceRef.relPath too long");
  const relPath = relPathRaw || undefined;
  const key = relPath ? `${value.kind}:${id}:${relPath}` : `${value.kind}:${id}`;
  if (key.length > 384) fail("conflict", "workspaceRef too long");
  return { kind: value.kind, id, relPath, key };
}

