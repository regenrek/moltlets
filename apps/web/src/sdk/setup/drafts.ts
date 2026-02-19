import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from "node:crypto"
import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  lastErrorMessage,
  listRunMessages,
  parseProjectHostRequiredInput,
  parseProjectIdInput,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"

const SEALED_INPUT_ALGORITHM = "rsa-oaep-3072/aes-256-gcm"

export const SETUP_DRAFT_SECRET_SECTIONS = ["hostBootstrapCreds", "hostBootstrapSecrets"] as const
export type SetupDraftSecretSection = (typeof SETUP_DRAFT_SECRET_SECTIONS)[number]

export type SetupDraftInfrastructure = {
  serverType?: string
  image?: string
  location?: string
  allowTailscaleUdpIngress?: boolean
  volumeEnabled?: boolean
  volumeSizeGb?: number
}

export type SetupDraftConnection = {
  adminCidr?: string
  sshExposureMode?: "bootstrap" | "tailnet" | "public"
  sshKeyCount?: number
  sshAuthorizedKeys?: string[]
}

export type SetupDraftNonSecretPatch = {
  infrastructure?: SetupDraftInfrastructure
  connection?: SetupDraftConnection
}

type SetupDraftSectionView = {
  status: "set" | "missing"
  updatedAt?: number
  expiresAt?: number
  targetRunnerId?: Id<"runners">
}

export type SetupDraftView = {
  draftId: Id<"setupDrafts">
  hostName: string
  status: "draft" | "committing" | "committed" | "failed"
  version: number
  nonSecretDraft: SetupDraftNonSecretPatch
  sealedSecretDrafts: {
    hostBootstrapCreds: SetupDraftSectionView
    hostBootstrapSecrets: SetupDraftSectionView
  }
  updatedAt: number
  expiresAt: number
  committedAt?: number
  lastError?: string
}

function ensureNoExtraKeys(value: Record<string, unknown>, field: string, keys: string[]): void {
  const extra = Object.keys(value).filter((k) => !keys.includes(k))
  if (extra.length > 0) throw new Error(`${field} contains unsupported keys: ${extra.join(",")}`)
}

function parseSection(raw: unknown): SetupDraftSecretSection {
  if (typeof raw !== "string") throw new Error("section required")
  const section = raw.trim() as SetupDraftSecretSection
  if (!SETUP_DRAFT_SECRET_SECTIONS.includes(section)) throw new Error("section invalid")
  return section
}

function parseSetupDraftSaveNonSecretInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  expectedVersion?: number
  patch: SetupDraftNonSecretPatch
} {
  const base = parseProjectHostRequiredInput(data)
  const d = data as Record<string, unknown>
  const expectedVersionRaw = d["expectedVersion"]
  const expectedVersion =
    typeof expectedVersionRaw === "number" && Number.isFinite(expectedVersionRaw)
      ? Math.max(0, Math.trunc(expectedVersionRaw))
      : undefined

  const patchRaw = d["patch"]
  if (!patchRaw || typeof patchRaw !== "object" || Array.isArray(patchRaw)) {
    throw new Error("patch required")
  }
  const patchObj = patchRaw as Record<string, unknown>
  ensureNoExtraKeys(patchObj, "patch", ["infrastructure", "connection"])

  const patch: SetupDraftNonSecretPatch = {}
  if (patchObj.infrastructure !== undefined) {
    if (!patchObj.infrastructure || typeof patchObj.infrastructure !== "object" || Array.isArray(patchObj.infrastructure)) {
      throw new Error("patch.infrastructure invalid")
    }
    const infrastructureRaw = patchObj.infrastructure as Record<string, unknown>
    ensureNoExtraKeys(infrastructureRaw, "patch.infrastructure", [
      "serverType",
      "image",
      "location",
      "allowTailscaleUdpIngress",
      "volumeEnabled",
      "volumeSizeGb",
    ])
    patch.infrastructure = {
      serverType: typeof infrastructureRaw.serverType === "string" ? infrastructureRaw.serverType : undefined,
      image: typeof infrastructureRaw.image === "string" ? infrastructureRaw.image : undefined,
      location: typeof infrastructureRaw.location === "string" ? infrastructureRaw.location : undefined,
      allowTailscaleUdpIngress:
        typeof infrastructureRaw.allowTailscaleUdpIngress === "boolean"
          ? infrastructureRaw.allowTailscaleUdpIngress
          : undefined,
      volumeEnabled:
        typeof infrastructureRaw.volumeEnabled === "boolean"
          ? infrastructureRaw.volumeEnabled
          : undefined,
      volumeSizeGb:
        typeof infrastructureRaw.volumeSizeGb === "number" && Number.isFinite(infrastructureRaw.volumeSizeGb)
          ? Math.max(0, Math.trunc(infrastructureRaw.volumeSizeGb))
          : undefined,
    }
  }

  if (patchObj.connection !== undefined) {
    if (!patchObj.connection || typeof patchObj.connection !== "object" || Array.isArray(patchObj.connection)) {
      throw new Error("patch.connection invalid")
    }
    const connectionRaw = patchObj.connection as Record<string, unknown>
    ensureNoExtraKeys(connectionRaw, "patch.connection", [
      "adminCidr",
      "sshExposureMode",
      "sshKeyCount",
      "sshAuthorizedKeys",
    ])
    const sshAuthorizedKeys = Array.isArray(connectionRaw.sshAuthorizedKeys)
      ? Array.from(
          new Set(
            connectionRaw.sshAuthorizedKeys
              .map((row) => (typeof row === "string" ? row.trim() : ""))
              .filter(Boolean),
          ),
        )
      : undefined
    const modeRaw = typeof connectionRaw.sshExposureMode === "string" ? connectionRaw.sshExposureMode.trim() : ""
    const sshExposureMode =
      modeRaw === "bootstrap" || modeRaw === "tailnet" || modeRaw === "public"
        ? modeRaw
        : modeRaw
          ? (() => {
              throw new Error("patch.connection.sshExposureMode invalid")
            })()
          : undefined
    patch.connection = {
      adminCidr: typeof connectionRaw.adminCidr === "string" ? connectionRaw.adminCidr : undefined,
      sshExposureMode,
      sshKeyCount:
        typeof connectionRaw.sshKeyCount === "number" && Number.isFinite(connectionRaw.sshKeyCount)
          ? Math.max(0, Math.trunc(connectionRaw.sshKeyCount))
          : undefined,
      sshAuthorizedKeys,
    }
  }

  if (!patch.infrastructure && !patch.connection) throw new Error("patch required")

  return {
    projectId: base.projectId,
    host: base.host,
    expectedVersion,
    patch,
  }
}

function parseSetupDraftSaveSealedSectionInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  section: SetupDraftSecretSection
  targetRunnerId: Id<"runners">
  sealedInputB64: string
  sealedInputAlg: string
  sealedInputKeyId: string
  aad: string
  expectedVersion?: number
} {
  const base = parseProjectHostRequiredInput(data)
  const d = data as Record<string, unknown>
  const targetRunnerId = typeof d["targetRunnerId"] === "string" ? d["targetRunnerId"].trim() : ""
  const sealedInputB64 = typeof d["sealedInputB64"] === "string" ? d["sealedInputB64"].trim() : ""
  const sealedInputAlg = typeof d["sealedInputAlg"] === "string" ? d["sealedInputAlg"].trim() : ""
  const sealedInputKeyId = typeof d["sealedInputKeyId"] === "string" ? d["sealedInputKeyId"].trim() : ""
  const aad = typeof d["aad"] === "string" ? d["aad"].trim() : ""
  const expectedVersionRaw = d["expectedVersion"]
  const expectedVersion =
    typeof expectedVersionRaw === "number" && Number.isFinite(expectedVersionRaw)
      ? Math.max(0, Math.trunc(expectedVersionRaw))
      : undefined

  if (!targetRunnerId) throw new Error("targetRunnerId required")
  if (!sealedInputB64) throw new Error("sealedInputB64 required")
  if (!sealedInputAlg) throw new Error("sealedInputAlg required")
  if (!sealedInputKeyId) throw new Error("sealedInputKeyId required")
  if (!aad) throw new Error("aad required")

  return {
    projectId: base.projectId,
    host: base.host,
    section: parseSection(d["section"]),
    targetRunnerId: targetRunnerId as Id<"runners">,
    sealedInputB64,
    sealedInputAlg,
    sealedInputKeyId,
    aad,
    expectedVersion,
  }
}

function parseSetupDraftDiscardInput(data: unknown): { projectId: Id<"projects">; host: string } {
  const base = parseProjectHostRequiredInput(data)
  return { projectId: base.projectId, host: base.host }
}

function parseSetupDraftCommitInput(data: unknown): { projectId: Id<"projects">; host: string } {
  const base = parseProjectHostRequiredInput(data)
  return { projectId: base.projectId, host: base.host }
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
  const alg = String(params.alg || SEALED_INPUT_ALGORITHM).trim()
  if (alg !== SEALED_INPUT_ALGORITHM) throw new Error(`unsupported sealed-input alg: ${alg}`)
  const runnerPubSpkiB64 = String(params.runnerPubSpkiB64 || "").trim()
  if (!runnerPubSpkiB64) throw new Error("runner public key missing")
  const keyId = String(params.keyId || "").trim()
  if (!keyId) throw new Error("runner key id missing")
  const aad = String(params.aad || "").trim()
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

export function buildSetupDraftSectionAad(params: {
  projectId: Id<"projects">
  host: string
  section: SetupDraftSecretSection
  targetRunnerId: Id<"runners">
}): string {
  return `${params.projectId}:${params.host}:setupDraft:${params.section}:${params.targetRunnerId}`
}

type SetupDraftCommitPayload = {
  draftId: Id<"setupDrafts">
  hostName: string
  status: "draft" | "committing" | "committed" | "failed"
  version: number
  targetRunnerId: Id<"runners">
  nonSecretDraft: SetupDraftNonSecretPatch
  sealedSecretDrafts: {
    hostBootstrapCreds: {
      alg: string
      keyId: string
      targetRunnerId: Id<"runners">
      sealedInputB64: string
      aad: string
      updatedAt: number
      expiresAt: number
    }
    hostBootstrapSecrets: {
      alg: string
      keyId: string
      targetRunnerId: Id<"runners">
      sealedInputB64: string
      aad: string
      updatedAt: number
      expiresAt: number
    }
  }
}

function buildSetupApplyInput(params: {
  host: string
  draft: SetupDraftCommitPayload
}): {
  hostName: string
  configOps: Array<{ path: string; value?: string; valueJson?: string; del: boolean }>
  hostBootstrapCredsDraft: SetupDraftCommitPayload["sealedSecretDrafts"]["hostBootstrapCreds"]
  hostBootstrapSecretsDraft: SetupDraftCommitPayload["sealedSecretDrafts"]["hostBootstrapSecrets"]
} {
  const host = params.host
  const infrastructure = params.draft.nonSecretDraft.infrastructure || {}
  const connection = params.draft.nonSecretDraft.connection || {}
  const serverType = String(infrastructure.serverType || "").trim()
  const location = String(infrastructure.location || "").trim()
  const adminCidr = String(connection.adminCidr || "").trim()
  if (!serverType || !location) throw new Error("infrastructure draft incomplete")
  if (!adminCidr) throw new Error("connection draft incomplete")

  const sshExposureMode = String(connection.sshExposureMode || "bootstrap").trim() || "bootstrap"
  const image = typeof infrastructure.image === "string" ? infrastructure.image.trim() : ""
  const volumeEnabled =
    typeof infrastructure.volumeEnabled === "boolean"
      ? infrastructure.volumeEnabled
      : undefined
  const requestedVolumeSizeGb =
    typeof infrastructure.volumeSizeGb === "number" && Number.isFinite(infrastructure.volumeSizeGb)
      ? Math.max(0, Math.trunc(infrastructure.volumeSizeGb))
      : undefined
  const resolvedVolumeSizeGb =
    volumeEnabled === false
      ? 0
      : volumeEnabled === true
        ? requestedVolumeSizeGb && requestedVolumeSizeGb > 0
          ? requestedVolumeSizeGb
          : 50
        : requestedVolumeSizeGb
  const sshAuthorizedKeys = Array.isArray(connection.sshAuthorizedKeys)
    ? Array.from(new Set(connection.sshAuthorizedKeys.map((row) => String(row || "").trim()).filter(Boolean)))
    : []

  const configOps = [
    { path: `hosts.${host}.provisioning.provider`, value: "hetzner", del: false },
    { path: `hosts.${host}.hetzner.serverType`, value: serverType, del: false },
    { path: `hosts.${host}.hetzner.image`, value: image, del: false },
    { path: `hosts.${host}.hetzner.location`, value: location, del: false },
    {
      path: `hosts.${host}.hetzner.allowTailscaleUdpIngress`,
      valueJson: JSON.stringify(Boolean(infrastructure.allowTailscaleUdpIngress)),
      del: false,
    },
    ...(resolvedVolumeSizeGb === undefined
      ? []
      : [{
          path: `hosts.${host}.hetzner.volumeSizeGb`,
          valueJson: JSON.stringify(resolvedVolumeSizeGb),
          del: false,
        }]),
    ...(resolvedVolumeSizeGb === 0
      ? [{
          path: `hosts.${host}.hetzner.volumeLinuxDevice`,
          del: true,
        }]
      : []),
    { path: `hosts.${host}.provisioning.adminCidr`, value: adminCidr, del: false },
    { path: `hosts.${host}.sshExposure.mode`, value: sshExposureMode, del: false },
    ...(sshAuthorizedKeys.length > 0
      ? [{ path: "fleet.sshAuthorizedKeys", valueJson: JSON.stringify(sshAuthorizedKeys), del: false }]
      : []),
  ]

  return {
    hostName: host,
    configOps,
    hostBootstrapCredsDraft: params.draft.sealedSecretDrafts.hostBootstrapCreds,
    hostBootstrapSecretsDraft: params.draft.sealedSecretDrafts.hostBootstrapSecrets,
  }
}

function listNonSecretPatchKeys(patch: SetupDraftNonSecretPatch): string[] {
  const keys: string[] = []
  if (patch.infrastructure) {
    if (patch.infrastructure.serverType !== undefined) keys.push("infrastructure.serverType")
    if (patch.infrastructure.image !== undefined) keys.push("infrastructure.image")
    if (patch.infrastructure.location !== undefined) keys.push("infrastructure.location")
    if (patch.infrastructure.allowTailscaleUdpIngress !== undefined) keys.push("infrastructure.allowTailscaleUdpIngress")
    if (patch.infrastructure.volumeEnabled !== undefined) keys.push("infrastructure.volumeEnabled")
    if (patch.infrastructure.volumeSizeGb !== undefined) keys.push("infrastructure.volumeSizeGb")
  }
  if (patch.connection) {
    if (patch.connection.adminCidr !== undefined) keys.push("connection.adminCidr")
    if (patch.connection.sshExposureMode !== undefined) keys.push("connection.sshExposureMode")
    if (patch.connection.sshKeyCount !== undefined) keys.push("connection.sshKeyCount")
    if (patch.connection.sshAuthorizedKeys !== undefined) keys.push("connection.sshAuthorizedKeys")
  }
  return keys.length > 0 ? keys : ["nonSecretDraft"]
}

export const setupDraftGet = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftDiscardInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    return (await client.query(api.controlPlane.setupDrafts.get, {
      projectId: data.projectId,
      hostName: data.host,
    })) as SetupDraftView | null
  })

export const setupDraftSaveNonSecret = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftSaveNonSecretInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const draft = (await client.mutation(api.controlPlane.setupDrafts.saveNonSecret, {
      projectId: data.projectId,
      hostName: data.host,
      expectedVersion: data.expectedVersion,
      patch: data.patch,
    })) as SetupDraftView
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "setup.draft.save_non_secret",
      target: { host: data.host },
      data: { updatedKeys: listNonSecretPatchKeys(data.patch) },
    })
    return draft
  })

export const setupDraftSaveSealedSection = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftSaveSealedSectionInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const draft = (await client.mutation(api.controlPlane.setupDrafts.saveSealedSection, {
      projectId: data.projectId,
      hostName: data.host,
      section: data.section,
      targetRunnerId: data.targetRunnerId,
      sealedInputB64: data.sealedInputB64,
      sealedInputAlg: data.sealedInputAlg,
      sealedInputKeyId: data.sealedInputKeyId,
      aad: data.aad,
      expectedVersion: data.expectedVersion,
    })) as SetupDraftView
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "setup.draft.save_sealed_section",
      target: { host: data.host },
      data: { updatedKeys: [data.section] },
    })
    return draft
  })

export const setupDraftDiscard = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftDiscardInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    await client.mutation(api.controlPlane.setupDrafts.discard, {
      projectId: data.projectId,
      hostName: data.host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "setup.draft.discard",
      target: { host: data.host },
    })
    return { ok: true as const }
  })

export const setupDraftCommit = createServerFn({ method: "POST" })
  .inputValidator(parseSetupDraftCommitInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const draft = (await client.mutation(api.controlPlane.setupDrafts.getCommitPayload, {
      projectId: data.projectId,
      hostName: data.host,
    })) as SetupDraftCommitPayload

    const targetRunnerId = draft.targetRunnerId
    const applyInput = buildSetupApplyInput({ host: data.host, draft })

    try {
      const reserve = await client.mutation(api.controlPlane.jobs.reserveSealedInput, {
        projectId: data.projectId,
        kind: "setup_apply",
        title: `Setup apply (${data.host})`,
        host: data.host,
        targetRunnerId,
        payloadMeta: {
          hostName: data.host,
          args: ["setup", "apply", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
          updatedKeys: ["hostName", "configOps", "hostBootstrapCredsDraft", "hostBootstrapSecretsDraft"],
          configPaths: applyInput.configOps.map((op) => op.path),
          note: "setup draft single final apply",
        },
      })

      const aad = `${data.projectId}:${reserve.jobId}:${reserve.kind}:${targetRunnerId}`
      const sealedInputB64 = sealForRunnerNode({
        runnerPubSpkiB64: reserve.sealedInputPubSpkiB64,
        keyId: reserve.sealedInputKeyId,
        aad,
        plaintextJson: JSON.stringify(applyInput),
        alg: reserve.sealedInputAlg,
      })

      const queued = await client.mutation(api.controlPlane.jobs.finalizeSealedEnqueue, {
        projectId: data.projectId,
        jobId: reserve.jobId,
        kind: reserve.kind,
        sealedInputB64,
        sealedInputAlg: reserve.sealedInputAlg,
        sealedInputKeyId: reserve.sealedInputKeyId,
      })

      const terminal = await waitForRunTerminal({
        client,
        projectId: data.projectId,
        runId: queued.runId,
        timeoutMs: 120_000,
        pollMs: 700,
      })
      if (terminal.status !== "succeeded") {
        const messages = await listRunMessages({ client, runId: queued.runId, limit: 300 })
        throw new Error(terminal.errorMessage || lastErrorMessage(messages, "setup apply failed"))
      }

      const summary = await takeRunnerCommandResultObject({
        client,
        projectId: data.projectId,
        jobId: queued.jobId,
        runId: queued.runId,
      })
      if (!summary) throw new Error("setup apply result missing")
      const summarySafe = summary as Record<string, {}>

      const draftView = await client.mutation(api.controlPlane.setupDrafts.finishCommit, {
        projectId: data.projectId,
        hostName: data.host,
        status: "committed",
      })
      await client.mutation(api.security.auditLogs.append, {
        projectId: data.projectId,
        action: "setup.apply.commit",
        target: { host: data.host },
        data: {
          runId: queued.runId,
          jobId: queued.jobId,
          targetRunnerId,
          updatedKeys: ["configOps", "hostBootstrapCreds", "hostBootstrapSecrets"],
        },
      })

      return {
        ok: true as const,
        queued: true as const,
        runId: queued.runId,
        jobId: queued.jobId,
        targetRunnerId,
        summary: summarySafe,
        draft: draftView,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        await client.mutation(api.controlPlane.setupDrafts.finishCommit, {
          projectId: data.projectId,
          hostName: data.host,
          status: "failed",
          errorMessage: message,
        })
      } catch {
        // Best effort: preserve original failure for caller.
      }
      throw error
    }
  })
