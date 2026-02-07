import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

import { getRepoLayout, getGatewayWorkspaceDir } from "@clawlets/core/repo-layout"
import { ensureDir, pathExists, writeFileAtomic } from "@clawlets/core/lib/storage/fs-safe"
import { isFleetWorkspaceEditableDoc, FLEET_WORKSPACE_EDITABLE_DOCS } from "@clawlets/core/lib/project/fleet-workspaces"
import { moveToTrash } from "@clawlets/core/lib/storage/fs-trash"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { readClawletsEnvTokens } from "~/server/redaction"
import { runWithEventsAndStatus } from "~/sdk/runtime/server"
import { getRepoRoot } from "~/sdk/project"
import type {
  WorkspaceDocListItem,
  WorkspaceDocReadResult,
  WorkspaceDocScope,
  WorkspaceDocWriteResult,
  WorkspaceDocWriteScope,
} from "~/sdk/workspace"

const MAX_DOC_BYTES = 256 * 1024

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function normalizeDocText(input: string): { ok: true; text: string } | { ok: false; message: string } {
  const normalized = input.replace(/\r\n/g, "\n")
  const bytes = Buffer.byteLength(normalized, "utf8")
  if (bytes > MAX_DOC_BYTES) return { ok: false, message: `doc too large (${bytes} bytes, max ${MAX_DOC_BYTES})` }
  const withNewline = normalized.endsWith("\n") ? normalized : `${normalized}\n`
  return { ok: true, text: withNewline }
}

async function readTextIfExists(filePath: string): Promise<{ exists: boolean; text: string }> {
  if (!(await pathExists(filePath))) return { exists: false, text: "" }
  const text = await fs.readFile(filePath, "utf8")
  return { exists: true, text }
}

function resolveDocPath(params: {
  repoRoot: string
  scope: WorkspaceDocScope
  gatewayId?: string
  name: string
}): { commonPath: string; gatewayPath: string } {
  if (!isFleetWorkspaceEditableDoc(params.name)) {
    throw new Error(`invalid doc name: ${params.name}`)
  }

  const layout = getRepoLayout(params.repoRoot)
  const commonPath = path.join(layout.fleetWorkspacesCommonDir, params.name)

  const gatewayDir = params.gatewayId ? getGatewayWorkspaceDir(layout, params.gatewayId) : ""
  const gatewayPath = gatewayDir ? path.join(gatewayDir, params.name) : ""

  if (params.scope === "gateway" && !gatewayPath) throw new Error("gateway id required for scope=gateway")
  if (params.scope === "effective" && !gatewayPath) throw new Error("gateway id required for scope=effective")

  return { commonPath, gatewayPath }
}

export async function listWorkspaceDocsServer(params: {
  projectId: Id<"projects">
  gatewayId: string
}): Promise<{ repoRoot: string; docs: WorkspaceDocListItem[] }> {
  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)

  const layout = getRepoLayout(repoRoot)
  const gatewayDir = getGatewayWorkspaceDir(layout, params.gatewayId)

  const results: WorkspaceDocListItem[] = []
  for (const name of FLEET_WORKSPACE_EDITABLE_DOCS) {
    const defaultPath = path.join(layout.fleetWorkspacesCommonDir, name)
    const overridePath = path.join(gatewayDir, name)
    const [hasDefault, hasOverride] = await Promise.all([pathExists(defaultPath), pathExists(overridePath)])
    results.push({
      name,
      hasDefault,
      hasOverride,
      effective: hasOverride ? "override" : hasDefault ? "default" : "missing",
    })
  }

  return {
    repoRoot,
    docs: results,
  }
}

export async function readWorkspaceDocServer(params: {
  projectId: Id<"projects">
  gatewayId: string
  scope: WorkspaceDocScope
  name: string
}): Promise<WorkspaceDocReadResult> {
  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)

  const { commonPath, gatewayPath } = resolveDocPath({
    repoRoot,
    scope: params.scope,
    gatewayId: params.gatewayId || undefined,
    name: params.name,
  })

  const layout = getRepoLayout(repoRoot)
  const chosen =
    params.scope === "common"
      ? commonPath
      : params.scope === "gateway"
        ? gatewayPath
        : (await pathExists(gatewayPath)) ? gatewayPath : commonPath

  const rel = path.relative(layout.repoRoot, chosen)
  const r = await readTextIfExists(chosen)
  return {
    ok: true,
    exists: r.exists,
    content: r.text,
    sha256: r.exists ? sha256Hex(r.text) : "",
    pathRel: rel,
  }
}

export async function writeWorkspaceDocServer(params: {
  projectId: Id<"projects">
  gatewayId: string
  scope: WorkspaceDocWriteScope
  name: string
  content: string
  expectedSha256: string
}): Promise<WorkspaceDocWriteResult> {
  const normalized = normalizeDocText(params.content)
  if (!normalized.ok) return { ok: false, code: "invalid", message: normalized.message }

  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)
  const layout = getRepoLayout(repoRoot)

  const { commonPath, gatewayPath } = resolveDocPath({
    repoRoot,
    scope: params.scope,
    gatewayId: params.gatewayId || undefined,
    name: params.name,
  })
  const targetPath = params.scope === "common" ? commonPath : gatewayPath

  if (params.expectedSha256.trim()) {
    const existing = await readTextIfExists(targetPath)
    if (existing.exists) {
      const actual = sha256Hex(existing.text)
      if (actual !== params.expectedSha256.trim()) {
        return { ok: false, code: "conflict", message: "file changed on disk (reload and retry)" }
      }
    }
  }

  const redactTokens = await readClawletsEnvTokens(repoRoot)
  const { runId } = await client.mutation(api.runs.create, {
    projectId: params.projectId,
    kind: "workspace_write",
    title:
      params.scope === "common"
        ? `workspace write common/${params.name}`
        : `workspace write gateways/${params.gatewayId}/${params.name}`,
  })

  return await runWithEventsAndStatus({
    client,
    runId,
    redactTokens,
    fn: async (emit) => {
      await emit({ level: "info", message: `Writing ${path.relative(layout.repoRoot, targetPath)}` })
      await ensureDir(path.dirname(targetPath))
      await writeFileAtomic(targetPath, normalized.text)
      await emit({ level: "info", message: "Done." })
    },
    onAfterEvents: async () => {
      if (params.scope === "common") {
        await client.mutation(api.auditLogs.append, {
          projectId: params.projectId,
          action: "workspace.common.write",
          target: { doc: params.name },
          data: { runId },
        })
        return
      }
      await client.mutation(api.auditLogs.append, {
        projectId: params.projectId,
        action: "workspace.gateway.write",
        target: { gatewayId: params.gatewayId, doc: params.name },
        data: { runId },
      })
    },
    onSuccess: () => ({ ok: true as const, runId }),
  })
}

export async function resetWorkspaceDocOverrideServer(params: {
  projectId: Id<"projects">
  gatewayId: string
  name: string
  expectedSha256: string
}): Promise<WorkspaceDocWriteResult> {
  const client = createConvexClient()
  const repoRoot = await getRepoRoot(client, params.projectId)
  const layout = getRepoLayout(repoRoot)

  const { gatewayPath } = resolveDocPath({
    repoRoot,
    scope: "gateway",
    gatewayId: params.gatewayId,
    name: params.name,
  })

  const exists = await pathExists(gatewayPath)
  if (!exists) {
    return { ok: true }
  }

  if (params.expectedSha256.trim()) {
    const existing = await readTextIfExists(gatewayPath)
    if (existing.exists) {
      const actual = sha256Hex(existing.text)
      if (actual !== params.expectedSha256.trim()) {
        return { ok: false, code: "conflict", message: "file changed on disk (reload and retry)" }
      }
    }
  }

  const redactTokens = await readClawletsEnvTokens(repoRoot)
  const { runId } = await client.mutation(api.runs.create, {
    projectId: params.projectId,
    kind: "workspace_write",
    title: `workspace reset gateways/${params.gatewayId}/${params.name}`,
  })

  return await runWithEventsAndStatus({
    client,
    runId,
    redactTokens,
    fn: async (emit) => {
      await emit({ level: "info", message: `Resetting ${path.relative(layout.repoRoot, gatewayPath)}` })
      await moveToTrash(gatewayPath)
      await emit({ level: "info", message: "Moved to trash." })
    },
    onAfterEvents: async () => {
      await client.mutation(api.auditLogs.append, {
        projectId: params.projectId,
        action: "workspace.gateway.reset",
        target: { gatewayId: params.gatewayId, doc: params.name },
        data: { runId },
      })
    },
    onSuccess: () => ({ ok: true as const, runId }),
  })
}
