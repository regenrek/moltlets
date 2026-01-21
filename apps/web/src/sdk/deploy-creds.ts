import path from "node:path"

import { createServerFn } from "@tanstack/react-start"
import { loadDeployCreds, DEPLOY_CREDS_KEYS } from "@clawdlets/core/lib/deploy-creds"
import { getRepoLayout } from "@clawdlets/core/repo-layout"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient, type ConvexClient } from "~/server/convex"

async function getRepoRoot(
  client: ConvexClient,
  projectId: Id<"projects">,
): Promise<string> {
  const { project } = await client.query(api.projects.get, { projectId })
  return project.localPath
}

export type DeployCredsStatusKey = {
  key: string
  source: "env" | "file" | "default" | "unset"
  status: "set" | "unset"
  value?: string
}

export type DeployCredsStatus = {
  repoRoot: string
  envFile:
    | null
    | {
        origin: "default" | "explicit"
        status: "ok" | "missing" | "invalid"
        path: string
        error?: string
      }
  defaultEnvPath: string
  keys: DeployCredsStatusKey[]
  template: string
}

function renderTemplate(defaultEnvPath: string): string {
  const rel = path.relative(process.cwd(), defaultEnvPath) || defaultEnvPath
  const lines = [
    "# clawdlets deploy creds (local-only; never commit)",
    "# Used by: bootstrap, infra, lockdown, doctor",
    "#",
    `# Default path: ${rel}`,
    "",
    "HCLOUD_TOKEN=",
    "GITHUB_TOKEN=",
    "NIX_BIN=nix",
    "SOPS_AGE_KEY_FILE=",
    "",
  ]
  return lines.join("\n")
}

export const getDeployCredsStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input")
    const d = data as Record<string, unknown>
    return { projectId: d["projectId"] as Id<"projects"> }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const repoRoot = await getRepoRoot(client, data.projectId)
    const layout = getRepoLayout(repoRoot)
    const loaded = loadDeployCreds({ cwd: repoRoot })

    const keys: DeployCredsStatusKey[] = DEPLOY_CREDS_KEYS.map((key) => {
      const source = loaded.sources[key]
      const value = loaded.values[key]
      const isSecret = key === "HCLOUD_TOKEN" || key === "GITHUB_TOKEN"
      const status = value ? "set" : "unset"
      if (isSecret) return { key, source, status }
      return { key, source, status, value: value ? String(value) : undefined }
    })

    return {
      repoRoot,
      envFile: loaded.envFile ? { ...loaded.envFile } : null,
      defaultEnvPath: layout.envFilePath,
      keys,
      template: renderTemplate(layout.envFilePath),
    } satisfies DeployCredsStatus
  })
