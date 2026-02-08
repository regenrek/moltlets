import { createServerFn } from "@tanstack/react-start"
import {
  DEPLOY_CREDS_KEYS,
} from "@clawlets/core/lib/infra/deploy-creds"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  coerceString,
  coerceTrimmedString,
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseLastJsonMessage,
  parseProjectIdInput,
  waitForRunTerminal,
} from "~/sdk/runtime"

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
  defaultSopsAgeKeyPath: string
  keys: DeployCredsStatusKey[]
  template: string
}

type KeyCandidate = {
  path: string
  exists: boolean
  valid: boolean
  reason?: string
}

type LocalSubmitConfig = {
  port: number
  nonce: string
}

function parseRunnerJson(messages: string[]): Record<string, unknown> | null {
  const direct = parseLastJsonMessage<Record<string, unknown>>(messages)
  if (direct) return direct
  for (let i = messages.length - 1; i >= 0; i--) {
    const raw = coerceTrimmedString(messages[i])
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      continue
    }
  }
  return null
}

async function runRunnerJsonCommand(params: {
  projectId: Id<"projects">
  title: string
  args: string[]
  timeoutMs: number
}): Promise<{ runId: Id<"runs">; jobId: Id<"jobs">; json: Record<string, unknown> }> {
  const client = createConvexClient()
  await requireAdminProjectAccess(client, params.projectId)
  const queued = await enqueueRunnerCommand({
    client,
    projectId: params.projectId,
    runKind: "custom",
    title: params.title,
    args: params.args,
    note: "runner queued from deploy-creds endpoint",
  })
  const terminal = await waitForRunTerminal({
    client,
    projectId: params.projectId,
    runId: queued.runId,
    timeoutMs: params.timeoutMs,
    pollMs: 700,
  })
  const messages = await listRunMessages({ client, runId: queued.runId, limit: 300 })
  if (terminal.status !== "succeeded") {
    throw new Error(terminal.errorMessage || lastErrorMessage(messages, "runner command failed"))
  }
  const parsed = parseRunnerJson(messages)
  if (!parsed) throw new Error("runner output missing JSON payload")
  return { runId: queued.runId, jobId: queued.jobId, json: parsed }
}

export const getDeployCredsStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    try {
      const result = await runRunnerJsonCommand({
        projectId: data.projectId,
        title: "Deploy creds status",
        args: ["env", "show", "--json"],
        timeoutMs: 20_000,
      })
      const row = result.json
      const keys: DeployCredsStatusKey[] = Array.isArray(row.keys)
        ? row.keys
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
            .map((entry) => {
              const key = coerceTrimmedString(entry.key)
              const source = (coerceTrimmedString(entry.source) || "unset") as DeployCredsStatusKey["source"]
              const status = (coerceTrimmedString(entry.status) || "unset") as DeployCredsStatusKey["status"]
              const value = typeof entry.value === "string" ? entry.value : undefined
              return { key, source, status, ...(value ? { value } : {}) }
            })
            .filter((entry) => entry.key.length > 0)
        : []

      return {
        repoRoot: typeof row.repoRoot === "string" ? row.repoRoot : "",
        envFile:
          row.envFile && typeof row.envFile === "object" && !Array.isArray(row.envFile)
            ? {
                origin: String((row.envFile as any).origin || "default") as "default" | "explicit",
                status: String((row.envFile as any).status || "missing") as "ok" | "missing" | "invalid",
                path: String((row.envFile as any).path || ""),
                error: typeof (row.envFile as any).error === "string" ? (row.envFile as any).error : undefined,
              }
            : null,
        defaultEnvPath: typeof row.defaultEnvPath === "string" ? row.defaultEnvPath : "",
        defaultSopsAgeKeyPath: typeof row.defaultSopsAgeKeyPath === "string" ? row.defaultSopsAgeKeyPath : "",
        keys,
        template: typeof row.template === "string" ? row.template : "",
      } satisfies DeployCredsStatus
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err, "Unable to read deploy creds status. Check runner."), { cause: err })
    }
  })

export const updateDeployCreds = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const updatedKeysRaw = Array.isArray(d["updatedKeys"]) ? (d["updatedKeys"] as unknown[]) : []
    const allowedKeys = new Set<string>(DEPLOY_CREDS_KEYS)
    const out: string[] = []
    for (const row of updatedKeysRaw) {
      if (typeof row !== "string") throw new Error("invalid updatedKeys")
      const key = row.trim()
      if (!key) continue
      if (!allowedKeys.has(key)) throw new Error(`invalid updatedKeys entry: ${key}`)
      out.push(key)
    }
    if (out.length === 0) throw new Error("updatedKeys required")
    return { ...base, updatedKeys: Array.from(new Set(out)) }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const runners = await client.query(api.controlPlane.runners.listByProject, { projectId: data.projectId })
    const localSubmit = (runners || [])
      .filter((runner) =>
        runner.lastStatus === "online"
        && runner.capabilities?.supportsLocalSecretsSubmit
        && typeof runner.capabilities?.localSecretsPort === "number"
        && typeof runner.capabilities?.localSecretsNonce === "string"
        && runner.capabilities.localSecretsNonce.trim().length > 0,
      )
      .toSorted((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
      .map((runner) => ({
        port: Math.trunc(Number(runner.capabilities?.localSecretsPort || 0)),
        nonce: coerceTrimmedString(runner.capabilities?.localSecretsNonce),
      }))
      .find((row) => row.port >= 1024 && row.port <= 65535 && row.nonce.length > 0) || null

    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: "Deploy creds update",
      args: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
      note: "deploy creds values supplied directly to local runner submit endpoint or runner prompt",
    })

    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "deployCreds.update",
      target: { doc: ".clawlets/env" },
      data: {
        runId: queued.runId,
        updatedKeys: data.updatedKeys,
      },
    })

    return {
      ok: true as const,
      queued: true as const,
      runId: queued.runId,
      jobId: queued.jobId,
      updatedKeys: data.updatedKeys,
      localSubmitRequired: true as const,
      localSubmit: localSubmit as LocalSubmitConfig | null,
    }
  })

export const detectSopsAgeKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    try {
      const result = await runRunnerJsonCommand({
        projectId: data.projectId,
        title: "Detect SOPS age key",
        args: ["env", "detect-age-key", "--json"],
        timeoutMs: 20_000,
      })
      const row = result.json
      const candidates: KeyCandidate[] = Array.isArray(row.candidates)
        ? row.candidates
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
            .map((entry) => ({
              path: coerceString(entry.path),
              exists: Boolean(entry.exists),
              valid: Boolean(entry.valid),
              reason: typeof entry.reason === "string" ? entry.reason : undefined,
            }))
            .filter((entry) => entry.path.length > 0)
        : []
      return {
        operatorId: typeof row.operatorId === "string" ? row.operatorId : "operator",
        defaultOperatorPath: typeof row.defaultOperatorPath === "string" ? row.defaultOperatorPath : "",
        candidates,
        recommendedPath: typeof row.recommendedPath === "string" ? row.recommendedPath : null,
      }
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err, "Unable to detect age keys. Check runner."), { cause: err })
    }
  })

export const generateSopsAgeKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    try {
      const result = await runRunnerJsonCommand({
        projectId: data.projectId,
        title: "Generate SOPS age key",
        args: ["env", "generate-age-key", "--json"],
        timeoutMs: 40_000,
      })
      const row = result.json
      const ok = row.ok === true
      const keyPath = typeof row.keyPath === "string" ? row.keyPath : ""
      const publicKey = typeof row.publicKey === "string" ? row.publicKey : ""
      if (ok && keyPath) {
        await client.mutation(api.security.auditLogs.append, {
          projectId: data.projectId,
          action: "sops.operatorKey.generate",
          target: { doc: ".clawlets/keys/operators" },
          data: { runId: result.runId },
        })
      }
      if (!ok) {
        return {
          ok: false as const,
          message: typeof row.message === "string" ? row.message : "Unable to generate key.",
        }
      }
      return { ok: true as const, keyPath, publicKey }
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err, "Unable to generate age key. Check runner."), { cause: err })
    }
  })
