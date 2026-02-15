import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from "node:crypto"
import path from "node:path"
import { createServerFn } from "@tanstack/react-start"
import {
  DEPLOY_CREDS_KEYS,
  DEPLOY_CREDS_SECRET_KEYS,
} from "@clawlets/core/lib/infra/deploy-creds"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"
import { SEALED_INPUT_B64_MAX_CHARS } from "@clawlets/core/lib/runtime/control-plane-constants"
import { assertSafeHostName } from "@clawlets/shared/lib/identifiers"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  maskProjectToken,
  parseProjectTokenKeyring,
  PROJECT_TOKEN_KEY_ID_MAX_CHARS,
  PROJECT_TOKEN_KEY_LABEL_MAX_CHARS,
  PROJECT_TOKEN_VALUE_MAX_CHARS,
  resolveActiveProjectTokenEntry,
} from "~/lib/project-token-keyring"
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

type DeployCredsSource = "env" | "file" | "default" | "unset"
type DeployCredsEntryStatus = "set" | "unset"

type RunnerDeployCredsStatusKey = {
  key: string
  source: DeployCredsSource
  status: DeployCredsEntryStatus
  value?: string
}

export type DeployCredsStatusKey = {
  key: string
  source: DeployCredsSource
  status: DeployCredsEntryStatus
  value?: string
}

export type ProjectTokenKeyringKind = "hcloud" | "tailscale"

export type ProjectTokenKeyringSummary = {
  activeId: string
  itemCount: number
  hasActive: boolean
}

export type ProjectTokenKeyringStatus = {
  kind: ProjectTokenKeyringKind
  keyringKey: string
  activeKey: string
  activeId: string
  hasActive: boolean
  items: Array<{
    id: string
    label: string
    maskedValue: string
    isActive: boolean
  }>
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
  projectTokenKeyrings: {
    hcloud: ProjectTokenKeyringSummary
    tailscale: ProjectTokenKeyringSummary
  }
  projectTokenKeyringStatuses: {
    hcloud: ProjectTokenKeyringStatus
    tailscale: ProjectTokenKeyringStatus
  }
  template: string
}

type KeyCandidate = {
  path: string
  exists: boolean
  valid: boolean
  reason?: string
}

type ReserveDeployCredsWriteResult = {
  runId: Id<"runs">
  jobId: Id<"jobs">
  kind: string
  sealedInputAlg: string
  sealedInputKeyId: string
  sealedInputPubSpkiB64: string
}

const DEPLOY_CREDS_SECRET_KEY_SET = new Set<string>(DEPLOY_CREDS_SECRET_KEYS)
const DEPLOY_CREDS_KEY_SET = new Set<string>(DEPLOY_CREDS_KEYS)
const SEALED_INPUT_ALGORITHM = "rsa-oaep-3072/aes-256-gcm"

const PROJECT_TOKEN_KEYRING_KIND_CONFIG: Record<ProjectTokenKeyringKind, {
  keyringKey: string
  activeKey: string
  title: string
}> = {
  hcloud: {
    keyringKey: "HCLOUD_TOKEN_KEYRING",
    activeKey: "HCLOUD_TOKEN_KEYRING_ACTIVE",
    title: "Hetzner API key",
  },
  tailscale: {
    keyringKey: "TAILSCALE_AUTH_KEY_KEYRING",
    activeKey: "TAILSCALE_AUTH_KEY_KEYRING_ACTIVE",
    title: "Tailscale auth key",
  },
}

function parseProjectTokenKeyringKind(raw: unknown): ProjectTokenKeyringKind {
  const value = coerceTrimmedString(raw).toLowerCase()
  if (value === "hcloud" || value === "tailscale") return value
  throw new Error("kind must be hcloud or tailscale")
}

function parseProjectIdWithOptionalHostInput(raw: unknown): {
  projectId: Id<"projects">
  host?: string
} {
  const base = parseProjectIdInput(raw)
  const data = raw as Record<string, unknown>
  const hostRaw = coerceTrimmedString(data.host)
  if (!hostRaw) return base
  assertSafeHostName(hostRaw)
  return { ...base, host: hostRaw }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isHostScopedOperatorKeyPath(params: { keyPath: string; host: string }): boolean {
  const normalized = path.posix.normalize(params.keyPath.replaceAll("\\", "/"))
  const hostPattern = escapeRegExp(params.host)
  const expected = new RegExp(`(?:^|/)keys/operators/hosts/${hostPattern}/[^/]+\\.agekey$`)
  return expected.test(normalized)
}

function parseUpdatedKeys(raw: unknown): string[] {
  const rows = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const row of rows) {
    if (typeof row !== "string") throw new Error("invalid updatedKeys")
    const key = row.trim()
    if (!key) continue
    if (!DEPLOY_CREDS_KEY_SET.has(key)) throw new Error(`invalid updatedKeys entry: ${key}`)
    out.push(key)
  }
  const deduped = Array.from(new Set(out))
  if (deduped.length === 0) throw new Error("updatedKeys required")
  return deduped
}

function parseRunnerDeployCredsStatusKeys(raw: unknown): RunnerDeployCredsStatusKey[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      key: coerceTrimmedString(entry.key),
      source: (coerceTrimmedString(entry.source) || "unset") as DeployCredsSource,
      status: (coerceTrimmedString(entry.status) || "unset") as DeployCredsEntryStatus,
      value: typeof entry.value === "string" ? entry.value : undefined,
    }))
    .filter((entry) => entry.key.length > 0)
}

function indexRunnerDeployCredsStatusKeys(rows: RunnerDeployCredsStatusKey[]): Record<string, RunnerDeployCredsStatusKey> {
  const byKey: Record<string, RunnerDeployCredsStatusKey> = {}
  for (const row of rows) byKey[row.key] = row
  return byKey
}

function toPublicDeployCredsStatusKeys(rows: RunnerDeployCredsStatusKey[]): DeployCredsStatusKey[] {
  return rows.map((row) => {
    const value = !DEPLOY_CREDS_SECRET_KEY_SET.has(row.key) && typeof row.value === "string"
      ? row.value
      : undefined
    return value ? { ...row, value } : { key: row.key, source: row.source, status: row.status }
  })
}

function summarizeProjectTokenKeyring(params: { keyringRaw?: string; activeIdRaw?: string }): ProjectTokenKeyringSummary {
  const keyring = parseProjectTokenKeyring(params.keyringRaw)
  const activeEntry = resolveActiveProjectTokenEntry({
    keyring,
    activeId: coerceTrimmedString(params.activeIdRaw),
  })
  return {
    activeId: activeEntry?.id || "",
    itemCount: keyring.items.length,
    hasActive: Boolean(activeEntry?.value?.trim()),
  }
}

function deriveProjectTokenKeyringStatus(params: {
  kind: ProjectTokenKeyringKind
  keyringRaw?: string
  activeIdRaw?: string
}): ProjectTokenKeyringStatus {
  const cfg = PROJECT_TOKEN_KEYRING_KIND_CONFIG[params.kind]
  const keyring = parseProjectTokenKeyring(params.keyringRaw)
  const activeEntry = resolveActiveProjectTokenEntry({
    keyring,
    activeId: coerceTrimmedString(params.activeIdRaw),
  })
  const activeId = activeEntry?.id || ""
  return {
    kind: params.kind,
    keyringKey: cfg.keyringKey,
    activeKey: cfg.activeKey,
    activeId,
    hasActive: Boolean(activeEntry?.value?.trim()),
    items: keyring.items.map((entry) => ({
      id: entry.id,
      label: entry.label,
      maskedValue: maskProjectToken(entry.value),
      isActive: entry.id === activeId,
    })),
  }
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function fromBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
  return Buffer.from(padded, "base64")
}

function sealForRunnerNode(params: {
  runnerPubSpkiB64: string
  keyId: string
  aad: string
  plaintextJson: string
  alg?: string
}): string {
  const alg = coerceTrimmedString(params.alg) || SEALED_INPUT_ALGORITHM
  if (alg !== SEALED_INPUT_ALGORITHM) throw new Error(`unsupported sealed-input alg: ${alg}`)
  const runnerPubSpkiB64 = coerceTrimmedString(params.runnerPubSpkiB64)
  if (!runnerPubSpkiB64) throw new Error("runner public key missing")
  const keyId = coerceTrimmedString(params.keyId)
  if (!keyId) throw new Error("runner key id missing")
  const aad = coerceTrimmedString(params.aad)
  if (!aad) throw new Error("aad required")

  const pubDer = fromBase64Url(runnerPubSpkiB64)
  const publicKey = createPublicKey({ key: pubDer, format: "der", type: "spki" })
  const aesKey = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv)
  cipher.setAAD(Buffer.from(aad, "utf8"))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(params.plaintextJson, "utf8")), cipher.final()])
  const tag = cipher.getAuthTag()
  const wrapped = publicEncrypt(
    {
      key: publicKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    aesKey,
  )

  const envelope = {
    v: 1,
    alg,
    kid: keyId,
    iv: toBase64Url(iv),
    w: toBase64Url(wrapped),
    ct: toBase64Url(Buffer.concat([ciphertext, tag])),
  }
  return toBase64Url(Buffer.from(JSON.stringify(envelope), "utf8"))
}

async function runRunnerJsonCommand(params: {
  projectId: Id<"projects">
  title: string
  args: string[]
  timeoutMs: number
  targetRunnerId?: Id<"runners">
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
    targetRunnerId: params.targetRunnerId,
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

async function reserveDeployCredsWrite(params: {
  projectId: Id<"projects">
  targetRunnerId: Id<"runners">
  updatedKeys: string[]
}): Promise<ReserveDeployCredsWriteResult> {
  const client = createConvexClient()
  await requireAdminProjectAccess(client, params.projectId)
  const reserved = await client.mutation(api.controlPlane.jobs.reserveSealedInput, {
    projectId: params.projectId,
    kind: "custom",
    title: "Deploy creds update",
    targetRunnerId: params.targetRunnerId,
    payloadMeta: {
      args: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
      updatedKeys: params.updatedKeys,
      note: "deploy creds sealed input attached at finalize",
    },
  })
  return {
    runId: reserved.runId,
    jobId: reserved.jobId,
    kind: reserved.kind,
    sealedInputAlg: reserved.sealedInputAlg,
    sealedInputKeyId: reserved.sealedInputKeyId,
    sealedInputPubSpkiB64: reserved.sealedInputPubSpkiB64,
  }
}

async function reserveProjectTokenKeyringWrite(params: {
  projectId: Id<"projects">
  targetRunnerId: Id<"runners">
  title: string
  updatedKeys: string[]
}): Promise<ReserveDeployCredsWriteResult> {
  const client = createConvexClient()
  await requireAdminProjectAccess(client, params.projectId)
  const reserved = await client.mutation(api.controlPlane.jobs.reserveSealedInput, {
    projectId: params.projectId,
    kind: "custom",
    title: params.title,
    targetRunnerId: params.targetRunnerId,
    payloadMeta: {
      args: ["env", "token-keyring-mutate", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
      updatedKeys: params.updatedKeys,
      sealedInputKeys: ["action", "kind", "keyId", "label", "value"],
      note: "project token keyring sealed input attached at finalize",
    },
  })
  return {
    runId: reserved.runId,
    jobId: reserved.jobId,
    kind: reserved.kind,
    sealedInputAlg: reserved.sealedInputAlg,
    sealedInputKeyId: reserved.sealedInputKeyId,
    sealedInputPubSpkiB64: reserved.sealedInputPubSpkiB64,
  }
}

async function finalizeDeployCredsWrite(params: {
  projectId: Id<"projects">
  targetRunnerId: Id<"runners">
  jobId: Id<"jobs">
  kind: string
  sealedInputB64: string
  sealedInputAlg: string
  sealedInputKeyId: string
  updatedKeys: string[]
}): Promise<{ runId: Id<"runs">; jobId: Id<"jobs"> }> {
  const client = createConvexClient()
  await requireAdminProjectAccess(client, params.projectId)

  const queued = await client.mutation(api.controlPlane.jobs.finalizeSealedEnqueue, {
    projectId: params.projectId,
    jobId: params.jobId,
    kind: params.kind,
    sealedInputB64: params.sealedInputB64,
    sealedInputAlg: params.sealedInputAlg,
    sealedInputKeyId: params.sealedInputKeyId,
  })
  await client.mutation(api.security.auditLogs.append, {
    projectId: params.projectId,
    action: "deployCreds.update",
    target: { doc: "<runtimeDir>/env" },
    data: {
      runId: queued.runId,
      jobId: queued.jobId,
      targetRunnerId: params.targetRunnerId,
      updatedKeys: params.updatedKeys,
    },
  })
  return { runId: queued.runId, jobId: queued.jobId }
}

export const getDeployCredsStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const targetRunnerIdRaw = coerceTrimmedString(d.targetRunnerId)
    return {
      ...base,
      targetRunnerId: targetRunnerIdRaw ? (targetRunnerIdRaw as Id<"runners">) : undefined,
    }
  })
  .handler(async ({ data }) => {
    try {
      const result = await runRunnerJsonCommand({
        projectId: data.projectId,
        title: "Deploy creds status",
        args: ["env", "show", "--json"],
        timeoutMs: 20_000,
        targetRunnerId: data.targetRunnerId,
      })
      const row = result.json
      const rawKeys = parseRunnerDeployCredsStatusKeys(row.keys)
      const publicKeys = toPublicDeployCredsStatusKeys(rawKeys)
      const byKey = indexRunnerDeployCredsStatusKeys(rawKeys)

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
        keys: publicKeys,
        projectTokenKeyrings: {
          hcloud: summarizeProjectTokenKeyring({
            keyringRaw: byKey.HCLOUD_TOKEN_KEYRING?.value,
            activeIdRaw: byKey.HCLOUD_TOKEN_KEYRING_ACTIVE?.value,
          }),
          tailscale: summarizeProjectTokenKeyring({
            keyringRaw: byKey.TAILSCALE_AUTH_KEY_KEYRING?.value,
            activeIdRaw: byKey.TAILSCALE_AUTH_KEY_KEYRING_ACTIVE?.value,
          }),
        },
        projectTokenKeyringStatuses: {
          hcloud: deriveProjectTokenKeyringStatus({
            kind: "hcloud",
            keyringRaw: byKey.HCLOUD_TOKEN_KEYRING?.value,
            activeIdRaw: byKey.HCLOUD_TOKEN_KEYRING_ACTIVE?.value,
          }),
          tailscale: deriveProjectTokenKeyringStatus({
            kind: "tailscale",
            keyringRaw: byKey.TAILSCALE_AUTH_KEY_KEYRING?.value,
            activeIdRaw: byKey.TAILSCALE_AUTH_KEY_KEYRING_ACTIVE?.value,
          }),
        },
        template: typeof row.template === "string" ? row.template : "",
      } satisfies DeployCredsStatus
    } catch (err) {
      throw new Error(sanitizeErrorMessage(err, "Unable to read deploy creds status. Check runner."), { cause: err })
    }
  })

type MutateProjectTokenKeyringAction = "add" | "remove" | "select"

export const mutateProjectTokenKeyring = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const action = coerceTrimmedString(d.action) as MutateProjectTokenKeyringAction
    if (action !== "add" && action !== "remove" && action !== "select") {
      throw new Error("action must be add, remove, or select")
    }
    const targetRunnerIdRaw = coerceTrimmedString(d.targetRunnerId)
    if (!targetRunnerIdRaw) throw new Error("targetRunnerId required")

    const keyId = coerceTrimmedString(d.keyId)
    const label = coerceString(d.label).trim()
    const value = coerceString(d.value).trim()

    if (keyId && keyId.length > PROJECT_TOKEN_KEY_ID_MAX_CHARS) {
      throw new Error(`keyId too long (max ${PROJECT_TOKEN_KEY_ID_MAX_CHARS} chars)`)
    }
    if (action === "add" && !value) throw new Error("value required")
    if (action === "add" && value.length > PROJECT_TOKEN_VALUE_MAX_CHARS) {
      throw new Error(`value too long (max ${PROJECT_TOKEN_VALUE_MAX_CHARS} chars)`)
    }
    if (action === "add" && label.length > PROJECT_TOKEN_KEY_LABEL_MAX_CHARS) {
      throw new Error(`label too long (max ${PROJECT_TOKEN_KEY_LABEL_MAX_CHARS} chars)`)
    }
    if ((action === "remove" || action === "select") && !keyId) throw new Error("keyId required")

    return {
      ...base,
      kind: parseProjectTokenKeyringKind(d.kind),
      action,
      targetRunnerId: targetRunnerIdRaw as Id<"runners">,
      keyId,
      label,
      value,
    }
  })
  .handler(async ({ data }) => {
    const cfg = PROJECT_TOKEN_KEYRING_KIND_CONFIG[data.kind]
    const updatedKeys = data.action === "select"
      ? [cfg.activeKey]
      : [cfg.keyringKey, cfg.activeKey]

    const reserved = await reserveProjectTokenKeyringWrite({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      title: `Project token keyring update (${cfg.title})`,
      updatedKeys,
    })

    const payload = {
      action: data.action,
      kind: data.kind,
      ...(data.keyId ? { keyId: data.keyId } : {}),
      ...(data.label ? { label: data.label } : {}),
      ...(data.value ? { value: data.value } : {}),
    }

    const aad = `${data.projectId}:${reserved.jobId}:${reserved.kind}:${data.targetRunnerId}`
    const sealedInputB64 = sealForRunnerNode({
      runnerPubSpkiB64: reserved.sealedInputPubSpkiB64,
      keyId: reserved.sealedInputKeyId,
      alg: reserved.sealedInputAlg,
      aad,
      plaintextJson: JSON.stringify(payload),
    })
    if (sealedInputB64.length > SEALED_INPUT_B64_MAX_CHARS) {
      throw new Error("sealedInputB64 too large")
    }

    const queued = await finalizeDeployCredsWrite({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      jobId: reserved.jobId,
      kind: reserved.kind,
      sealedInputB64,
      sealedInputAlg: reserved.sealedInputAlg,
      sealedInputKeyId: reserved.sealedInputKeyId,
      updatedKeys,
    })

    return {
      ok: true as const,
      queued: true as const,
      runId: queued.runId,
      jobId: queued.jobId,
      updatedKeys,
      targetRunnerId: data.targetRunnerId,
      kind: data.kind,
      action: data.action,
    }
  })

export const updateDeployCreds = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const targetRunnerIdRaw = coerceTrimmedString(d.targetRunnerId)
    if (!targetRunnerIdRaw) throw new Error("targetRunnerId required")
    return {
      ...base,
      targetRunnerId: targetRunnerIdRaw as Id<"runners">,
      updatedKeys: parseUpdatedKeys(d.updatedKeys),
    }
  })
  .handler(async ({ data }) => {
    const reserved = await reserveDeployCredsWrite({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      updatedKeys: data.updatedKeys,
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
    const targetRunnerIdRaw = coerceTrimmedString(d.targetRunnerId)
    if (!targetRunnerIdRaw) throw new Error("targetRunnerId required")
    const jobIdRaw = coerceTrimmedString(d.jobId)
    if (!jobIdRaw) throw new Error("jobId required")
    const kindRaw = coerceTrimmedString(d.kind)
    if (!kindRaw) throw new Error("kind required")
    const sealedInputB64Raw = coerceTrimmedString(d.sealedInputB64)
    if (!sealedInputB64Raw) throw new Error("sealedInputB64 required")
    if (sealedInputB64Raw.length > SEALED_INPUT_B64_MAX_CHARS) throw new Error("sealedInputB64 too large")
    const sealedInputAlgRaw = coerceTrimmedString(d.sealedInputAlg)
    if (!sealedInputAlgRaw) throw new Error("sealedInputAlg required")
    const sealedInputKeyIdRaw = coerceTrimmedString(d.sealedInputKeyId)
    if (!sealedInputKeyIdRaw) throw new Error("sealedInputKeyId required")
    return {
      ...base,
      jobId: jobIdRaw as Id<"jobs">,
      kind: kindRaw,
      sealedInputB64: sealedInputB64Raw,
      sealedInputAlg: sealedInputAlgRaw,
      sealedInputKeyId: sealedInputKeyIdRaw,
      targetRunnerId: targetRunnerIdRaw as Id<"runners">,
      updatedKeys: parseUpdatedKeys(d.updatedKeys),
    }
  })
  .handler(async ({ data }) => {
    const queued = await finalizeDeployCredsWrite({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      jobId: data.jobId,
      kind: data.kind,
      sealedInputB64: data.sealedInputB64,
      sealedInputAlg: data.sealedInputAlg,
      sealedInputKeyId: data.sealedInputKeyId,
      updatedKeys: data.updatedKeys,
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
  .inputValidator((data: unknown) => parseProjectIdWithOptionalHostInput(data))
  .handler(async ({ data }) => {
    try {
      const hostFlag = data.host ? ["--host", data.host] : []
      const result = await runRunnerJsonCommand({
        projectId: data.projectId,
        title: "Detect SOPS age key",
        args: ["env", "detect-age-key", ...hostFlag, "--json"],
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
  .inputValidator((data: unknown) => parseProjectIdWithOptionalHostInput(data))
  .handler(async ({ data }) => {
    const client = createConvexClient()
    try {
      const hostFlag = data.host ? ["--host", data.host] : []
      const result = await runRunnerJsonCommand({
        projectId: data.projectId,
        title: "Generate SOPS age key",
        args: ["env", "generate-age-key", ...hostFlag, "--json"],
        timeoutMs: 40_000,
      })
      const row = result.json
      const ok = row.ok === true
      const keyPath = typeof row.keyPath === "string" ? row.keyPath : ""
      const publicKey = typeof row.publicKey === "string" ? row.publicKey : ""
      const created = row.created === false ? false : true
      if (ok && data.host && !isHostScopedOperatorKeyPath({ keyPath, host: data.host })) {
        return {
          ok: false as const,
          message: "Runner returned non host-scoped SOPS key path.",
        }
      }
      if (ok && keyPath && created) {
        await client.mutation(api.security.auditLogs.append, {
          projectId: data.projectId,
          action: "sops.operatorKey.generate",
          target: {
            doc: data.host
              ? `<runtimeDir>/keys/operators/hosts/${data.host}`
              : "<runtimeDir>/keys/operators",
          },
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
