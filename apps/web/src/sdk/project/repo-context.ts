import type { Id } from "../../../convex/_generated/dataModel"
import type { ConvexClient } from "~/server/convex"
import { assertRepoRootPath } from "~/server/paths"
import { getProjectAccess, requireAdminProjectAccess, type ProjectAccess } from "./context"

export type ProjectContext = ProjectAccess & { repoRoot: string }

export type RepoRootOptions = {
  allowMissing?: boolean
  requireRepoLayout?: boolean
}

function requireLocalRepoRoot(
  project: { executionMode: "local" | "remote_runner"; localPath?: string; runnerRepoPath?: string },
  options: RepoRootOptions,
): string {
  if (project.executionMode !== "local") {
    throw new Error("project executionMode=remote_runner has no local repo root")
  }
  const localPath = String(project.localPath || "").trim()
  if (!localPath) {
    throw new Error("project localPath missing for local execution mode")
  }
  return assertRepoRootPath(localPath, {
    allowMissing: options.allowMissing === true,
    requireRepoLayout: options.requireRepoLayout === true,
  })
}

export async function getProjectContext(
  client: ConvexClient,
  projectId: Id<"projects">,
  options: RepoRootOptions = {},
): Promise<ProjectContext> {
  const result = await getProjectAccess(client, projectId)
  const repoRoot = requireLocalRepoRoot(result.project, options)
  return { ...result, repoRoot }
}

export async function getRepoRoot(
  client: ConvexClient,
  projectId: Id<"projects">,
): Promise<string> {
  const { repoRoot } = await getProjectContext(client, projectId, {
    allowMissing: false,
    requireRepoLayout: true,
  })
  return repoRoot
}

export async function getAdminProjectContext(
  client: ConvexClient,
  projectId: Id<"projects">,
  options: RepoRootOptions = {},
): Promise<ProjectContext> {
  const result = await requireAdminProjectAccess(client, projectId)
  const repoRoot = requireLocalRepoRoot(result.project, options)
  return { ...result, repoRoot }
}
