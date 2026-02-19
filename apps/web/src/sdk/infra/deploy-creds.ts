import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from "node:crypto"
import path from "node:path"
import { createServerFn } from "@tanstack/react-start"
import {
  DEPLOY_CREDS_KEYS,
} from "@clawlets/core/lib/infra/deploy-creds"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"
import { SEALED_INPUT_B64_MAX_CHARS } from "@clawlets/core/lib/runtime/control-plane-constants"
import { assertSafeHostName } from "@clawlets/shared/lib/identifiers"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  PROJECT_TOKEN_KEY_ID_MAX_CHARS,
  PROJECT_TOKEN_KEY_LABEL_MAX_CHARS,
  PROJECT_TOKEN_VALUE_MAX_CHARS,
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

export type ProjectTokenKeyringKind = "hcloud" | "tailscale"
type ProjectCredentialSection = "hcloudKeyring" | "tailscaleKeyring" | "githubToken"

type KeyCandidate = {
  path: string
  exists: boolean
  valid: boolean
  reason?: string
}

type SealedJobReservation = {
  runId: Id<"runs">
  jobId: Id<"jobs">
  kind: string
  sealedInputAlg: string
  sealedInputKeyId: string
  sealedInputPubSpkiB64: string
}

const DEPLOY_CREDS_KEY_SET = new Set<string>(DEPLOY_CREDS_KEYS)
const SEALED_INPUT_ALGORITHM = "rsa-oaep-3072/aes-256-gcm"

const PROJECT_TOKEN_KEYRING_KIND_CONFIG: Record<ProjectTokenKeyringKind, {
  keyringKey: string
  activeKey: string
  title: string
  section: ProjectCredentialSection
}> = {
  hcloud: {
    keyringKey: "HCLOUD_TOKEN_KEYRING",
    activeKey: "HCLOUD_TOKEN_KEYRING_ACTIVE",
    title: "Hetzner API key",
    section: "hcloudKeyring",
  },
  tailscale: {
    keyringKey: "TAILSCALE_AUTH_KEY_KEYRING",
    activeKey: "TAILSCALE_AUTH_KEY_KEYRING_ACTIVE",
    title: "Tailscale auth key",
    section: "tailscaleKeyring",
  },
}

function projectCredentialSectionsFromUpdatedKeys(updatedKeys: string[]): ProjectCredentialSection[] {
  const out = new Set<ProjectCredentialSection>()
  for (const row of updatedKeys) {
    const key = row.trim()
    if (!key) continue
    if (key === "GITHUB_TOKEN") out.add("githubToken")
    if (key === "HCLOUD_TOKEN_KEYRING" || key === "HCLOUD_TOKEN_KEYRING_ACTIVE") out.add("hcloudKeyring")
    if (key === "TAILSCALE_AUTH_KEY_KEYRING" || key === "TAILSCALE_AUTH_KEY_KEYRING_ACTIVE") out.add("tailscaleKeyring")
  }
  return Array.from(out)
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

async function reserveSealedRunnerJob(params: {
  projectId: Id<"projects">
  targetRunnerId: Id<"runners">
  title: string
  args: string[]
  updatedKeys: string[]
  sealedInputKeys?: string[]
  note: string
}): Promise<SealedJobReservation> {
  const client = createConvexClient()
  await requireAdminProjectAccess(client, params.projectId)
  const reserved = await client.mutation(api.controlPlane.jobs.reserveSealedInput, {
    projectId: params.projectId,
    kind: "custom",
    title: params.title,
    targetRunnerId: params.targetRunnerId,
    payloadMeta: {
      args: params.args,
      updatedKeys: params.updatedKeys,
      ...(Array.isArray(params.sealedInputKeys) && params.sealedInputKeys.length > 0
        ? { sealedInputKeys: params.sealedInputKeys }
        : {}),
      note: params.note,
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

async function finalizeSealedRunnerJob(params: {
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

async function upsertProjectCredentialPending(params: {
  projectId: Id<"projects">
  section: ProjectCredentialSection
  metadata?: {
    status?: "set" | "unset"
    hasActive?: boolean
    itemCount?: number
    items?: Array<{
      id: string
      label: string
      maskedValue: string
      isActive: boolean
    }>
  }
  targetRunnerId: Id<"runners">
  sealedInputB64: string
  sealedInputAlg: string
  sealedInputKeyId: string
}): Promise<void> {
  const client = createConvexClient()
  await requireAdminProjectAccess(client, params.projectId)
  await client.mutation(api.controlPlane.projectCredentials.upsertPending, {
    projectId: params.projectId,
    section: params.section,
    ...(params.metadata ? { metadata: params.metadata } : {}),
    sealedValueB64: params.sealedInputB64,
    sealedForRunnerId: params.targetRunnerId,
    sealedInputAlg: params.sealedInputAlg,
    sealedInputKeyId: params.sealedInputKeyId,
    syncStatus: "pending",
  })
}

type MutateProjectTokenKeyringAction = "add" | "remove" | "select"

export const queueProjectTokenKeyringUpdate = createServerFn({ method: "POST" })
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

    const reserved = await reserveSealedRunnerJob({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      title: `Project token keyring update (${cfg.title})`,
      args: ["env", "token-keyring-mutate", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
      updatedKeys,
      sealedInputKeys: ["action", "kind", "keyId", "label", "value"],
      note: "project token keyring sealed input attached at finalize",
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

    const queued = await finalizeSealedRunnerJob({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      jobId: reserved.jobId,
      kind: reserved.kind,
      sealedInputB64,
      sealedInputAlg: reserved.sealedInputAlg,
      sealedInputKeyId: reserved.sealedInputKeyId,
      updatedKeys,
    })
    await upsertProjectCredentialPending({
      projectId: data.projectId,
      section: cfg.section,
      targetRunnerId: data.targetRunnerId,
      sealedInputB64,
      sealedInputAlg: reserved.sealedInputAlg,
      sealedInputKeyId: reserved.sealedInputKeyId,
      ...(data.action === "select"
        ? {
            metadata: {
              status: "set" as const,
              hasActive: true,
            },
          }
        : {}),
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

function parseDeployCredUpdatesInput(data: unknown): {
  projectId: Id<"projects">
  targetRunnerId: Id<"runners">
  updatedKeys: string[]
  updates: Record<string, string>
} {
  const base = parseProjectIdInput(data)
  const d = data as Record<string, unknown>
  const targetRunnerIdRaw = coerceTrimmedString(d.targetRunnerId)
  if (!targetRunnerIdRaw) throw new Error("targetRunnerId required")
  const updatesRaw = d.updates
  if (!updatesRaw || typeof updatesRaw !== "object" || Array.isArray(updatesRaw)) {
    throw new Error("updates required")
  }
  const updatesObj = updatesRaw as Record<string, unknown>
  const updates: Record<string, string> = {}
  const updatedKeys: string[] = []
  for (const [rawKey, rawValue] of Object.entries(updatesObj)) {
    const key = coerceTrimmedString(rawKey)
    if (!key) continue
    if (!DEPLOY_CREDS_KEY_SET.has(key)) throw new Error(`invalid updates key: ${key}`)
    if (typeof rawValue !== "string") throw new Error(`invalid updates value type for ${key}`)
    updates[key] = rawValue
    updatedKeys.push(key)
  }
  const dedupedUpdatedKeys = Array.from(new Set(updatedKeys))
  if (dedupedUpdatedKeys.length === 0) throw new Error("updates required")
  return {
    ...base,
    targetRunnerId: targetRunnerIdRaw as Id<"runners">,
    updates,
    updatedKeys: dedupedUpdatedKeys,
  }
}

export const queueDeployCredsUpdate = createServerFn({ method: "POST" })
  .inputValidator(parseDeployCredUpdatesInput)
  .handler(async ({ data }) => {
    const reserved = await reserveSealedRunnerJob({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      title: "Deploy creds update",
      args: ["env", "apply-json", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
      updatedKeys: data.updatedKeys,
      note: "deploy creds sealed input attached at finalize",
    })
    const aad = `${data.projectId}:${reserved.jobId}:${reserved.kind}:${data.targetRunnerId}`
    const sealedInputB64 = sealForRunnerNode({
      runnerPubSpkiB64: reserved.sealedInputPubSpkiB64,
      keyId: reserved.sealedInputKeyId,
      alg: reserved.sealedInputAlg,
      aad,
      plaintextJson: JSON.stringify(data.updates),
    })
    if (sealedInputB64.length > SEALED_INPUT_B64_MAX_CHARS) throw new Error("sealedInputB64 too large")

    const queued = await finalizeSealedRunnerJob({
      projectId: data.projectId,
      targetRunnerId: data.targetRunnerId,
      jobId: reserved.jobId,
      kind: reserved.kind,
      sealedInputB64,
      sealedInputAlg: reserved.sealedInputAlg,
      sealedInputKeyId: reserved.sealedInputKeyId,
      updatedKeys: data.updatedKeys,
    })
    for (const section of projectCredentialSectionsFromUpdatedKeys(data.updatedKeys)) {
      await upsertProjectCredentialPending({
        projectId: data.projectId,
        section,
        targetRunnerId: data.targetRunnerId,
        sealedInputB64,
        sealedInputAlg: reserved.sealedInputAlg,
        sealedInputKeyId: reserved.sealedInputKeyId,
      })
    }
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
