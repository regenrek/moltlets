import fs from "node:fs/promises"

import { createServerFn } from "@tanstack/react-start"
import { loadClawletsConfig } from "@clawlets/core/lib/clawlets-config"
import { createSecretsTar } from "@clawlets/core/lib/secrets-tar"
import { getRepoLayout, getHostRemoteSecretsDir, getHostSecretsDir } from "@clawlets/core/repo-layout"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { resolveClawletsCliEntry } from "~/server/clawlets-cli"
import { readClawletsEnvTokens } from "~/server/redaction"
import { getClawletsCliEnv } from "~/server/run-env"
import { spawnCommand } from "~/server/run-manager"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { parseProjectHostInput, parseProjectRunHostInput } from "~/sdk/serverfn-validators"
import { resolveHostFromConfig } from "~/sdk/secrets-helpers"
import { requireAdminAndBoundRun } from "~/sdk/run-guards"

export const secretsSyncStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawletsConfig({ repoRoot })
    const host = resolveHostFromConfig(config, data.host, { requireKnownHost: true })

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "secrets_sync",
      title: `Secrets sync (${host})`,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.sync",
      target: { host },
      data: { runId },
    })
    return { runId }
  })

export const secretsSyncPreview = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawletsConfig({ repoRoot })
    const host = resolveHostFromConfig(config, data.host)

    const layout = getRepoLayout(repoRoot)
    const localDir = getHostSecretsDir(layout, host)
    const remoteDir = getHostRemoteSecretsDir(host)

    let tarPath = ""
    try {
      const created = await createSecretsTar({ hostName: host, localDir })
      tarPath = created.tarPath
      return {
        ok: true as const,
        localDir,
        remoteDir,
        digest: created.digest,
        files: created.files,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, localDir, remoteDir, message }
    } finally {
      if (tarPath) {
        try {
          await fs.rm(tarPath, { force: true })
        } catch {
          // ignore
        }
      }
    }
  })

export const secretsSyncExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await requireAdminAndBoundRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "secrets_sync",
    })

    try {
      const { config } = loadClawletsConfig({ repoRoot })
      if (!config.hosts[data.host]) throw new Error(`unknown host: ${data.host}`)
      const redactTokens = await readClawletsEnvTokens(repoRoot)
      const cliEntry = resolveClawletsCliEntry()
      const cliEnv = getClawletsCliEnv()

      await spawnCommand({
        client,
        runId: data.runId,
        cwd: repoRoot,
        cmd: "node",
        args: [cliEntry, "secrets", "sync", "--host", data.host, "--ssh-tty=false"],
        env: cliEnv.env,
        envAllowlist: cliEnv.envAllowlist,
        redactTokens,
      })
      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: "succeeded",
      })
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await client.mutation(api.runs.setStatus, {
        runId: data.runId,
        status: "failed",
        errorMessage: message,
      })
      return { ok: false as const, message }
    }
  })
