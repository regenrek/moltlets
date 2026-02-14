import { createServerFn } from "@tanstack/react-start"
import {
  DEPLOY_CREDS_KEYS,
  DEPLOY_CREDS_SECRET_KEYS,
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
  parseProjectIdInput,
  takeRunnerCommandResultObject,
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

const DEPLOY_CREDS_SECRET_KEY_SET = new Set<string>(DEPLOY_CREDS_SECRET_KEYS)

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
  const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId, limit: 300 })
  if (terminal.status !== "succeeded") {
    throw new Error(terminal.errorMessage || lastErrorMessage(messages, "runner command failed"))
  }
  const parsed = await takeRunnerCommandResultObject({
    client,
    projectId: params.projectId,
    jobId: queued.jobId,
    runId: queued.runId,
  })
  if (!parsed) throw new Error("runner command result missing JSON payload")
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
              const value =
                typeof entry.value === "string" && !DEPLOY_CREDS_SECRET_KEY_SET.has(key)
                  ? entry.value
                  : undefined
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
    const targetRunnerIdRaw = typeof d["targetRunnerId"] === "string" ? d["targetRunnerId"].trim() : ""
    if (!targetRunnerIdRaw) throw new Error("targetRunnerId required")
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
    return {
      ...base,
      targetRunnerId: targetRunnerIdRaw as Id<"runners">,
      updatedKeys: Array.from(new Set(out)),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const reserved = await client.mutation(api.controlPlane.jobs.reserveSealedInput, {
      projectId: data.projectId,
      kind: "custom",
      title: "Deploy creds update",
      targetRunnerId: data.targetRunnerId,
      payloadMeta: {
        args: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
        updatedKeys: data.updatedKeys,
        note: "deploy creds sealed input attached at finalize",
      },
    })
    return {
      ok: true as const,
      reserved: true as const,
      runId: reserved.runId,
      jobId: reserved.jobId,
      kind: reserved.kind,
      sealedInputAlg: reserved.sealedInputAlg,
      sealedInputKeyId: reserved.sealedInputKeyId,
      sealedInputPubSpkiB64: reserved.sealedInputPubSpkiB64,
      updatedKeys: data.updatedKeys,
      targetRunnerId: data.targetRunnerId,
    }
  })

export const finalizeDeployCreds = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const targetRunnerIdRaw = typeof d["targetRunnerId"] === "string" ? d["targetRunnerId"].trim() : ""
    if (!targetRunnerIdRaw) throw new Error("targetRunnerId required")
    const jobIdRaw = typeof d["jobId"] === "string" ? d["jobId"].trim() : ""
    if (!jobIdRaw) throw new Error("jobId required")
    const kindRaw = typeof d["kind"] === "string" ? d["kind"].trim() : ""
    if (!kindRaw) throw new Error("kind required")
    const sealedInputB64Raw = typeof d["sealedInputB64"] === "string" ? d["sealedInputB64"].trim() : ""
    if (!sealedInputB64Raw) throw new Error("sealedInputB64 required")
    const sealedInputAlgRaw = typeof d["sealedInputAlg"] === "string" ? d["sealedInputAlg"].trim() : ""
    if (!sealedInputAlgRaw) throw new Error("sealedInputAlg required")
    const sealedInputKeyIdRaw = typeof d["sealedInputKeyId"] === "string" ? d["sealedInputKeyId"].trim() : ""
    if (!sealedInputKeyIdRaw) throw new Error("sealedInputKeyId required")
    const updatedKeysRaw = Array.isArray(d["updatedKeys"]) ? (d["updatedKeys"] as unknown[]) : []
    const updatedKeys = updatedKeysRaw
      .map((row) => (typeof row === "string" ? row.trim() : ""))
      .filter(Boolean)
    if (updatedKeys.length === 0) throw new Error("updatedKeys required")
    return {
      ...base,
      jobId: jobIdRaw as Id<"jobs">,
      kind: kindRaw,
      sealedInputB64: sealedInputB64Raw,
      sealedInputAlg: sealedInputAlgRaw,
      sealedInputKeyId: sealedInputKeyIdRaw,
      targetRunnerId: targetRunnerIdRaw as Id<"runners">,
      updatedKeys: Array.from(new Set(updatedKeys)),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const queued = await client.mutation(api.controlPlane.jobs.finalizeSealedEnqueue, {
      projectId: data.projectId,
      jobId: data.jobId,
      kind: data.kind,
      sealedInputB64: data.sealedInputB64,
      sealedInputAlg: data.sealedInputAlg,
      sealedInputKeyId: data.sealedInputKeyId,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "deployCreds.update",
      target: { doc: ".clawlets/env" },
      data: {
        runId: queued.runId,
        jobId: queued.jobId,
        targetRunnerId: data.targetRunnerId,
        updatedKeys: data.updatedKeys,
      },
    })
    return {
      ok: true as const,
      queued: true as const,
      runId: queued.runId,
      jobId: queued.jobId,
      targetRunnerId: data.targetRunnerId,
      updatedKeys: data.updatedKeys,
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
      const created = row.created === false ? false : true
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
      return { ok: true as const, keyPath, publicKey, created }
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err, "Unable to generate age key. Check runner."), { cause: err })
    }
  })
