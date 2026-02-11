import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { ConvexClient } from "~/server/convex"
export type ProjectAccess = {
  project: {
    executionMode: "local" | "remote_runner"
    localPath?: string
    runnerRepoPath?: string
    workspaceRef: { kind: "local" | "git"; id: string; relPath?: string }
  }
  role: "admin" | "viewer"
}

export async function getProjectAccess(
  client: ConvexClient,
  projectId: Id<"projects">,
): Promise<ProjectAccess> {
  const result = await client.query(api.controlPlane.projects.get, { projectId })
  return result
}

export async function requireAdminProjectAccess(
  client: ConvexClient,
  projectId: Id<"projects">,
): Promise<ProjectAccess> {
  const result = await getProjectAccess(client, projectId)
  if (result.role !== "admin") throw new Error("admin required")
  return result
}
