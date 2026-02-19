import { createServerFn } from "@tanstack/react-start"
import {
  assertSafeHostName,
} from "@clawlets/core/lib/config/clawlets-config"
import { generateHostName as generateRandomHostName } from "@clawlets/core/lib/host/host-name-generator"
import { parseSshPublicKeysFromText } from "@clawlets/core/lib/security/ssh"
import { parseKnownHostsFromText } from "@clawlets/core/lib/security/ssh-files"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  coerceString,
  coerceTrimmedString,
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseProjectIdInput,
  parseProjectSshKeysInput,
  waitForRunTerminal,
} from "~/sdk/runtime"

const HOST_ADD_SYNC_WAIT_MS = 8_000
const FLEET_SSH_AUTHORIZED_KEYS_PATH = "fleet.sshAuthorizedKeys"
const FLEET_SSH_KNOWN_HOSTS_PATH = "fleet.sshKnownHosts"
type ProjectId = Id<"projects">
type ConvexClient = ReturnType<typeof createConvexClient>

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((entry) => coerceTrimmedString(entry)).filter(Boolean)))
}

async function readProjectSshLists(params: { client: ConvexClient; projectId: ProjectId }): Promise<{
  authorized: string[]
  knownHosts: string[]
}> {
  const rows = await params.client.query(api.controlPlane.projectCredentials.listByProject, {
    projectId: params.projectId,
  })
  const bySection = new Map(rows.map((row) => [row.section, row]))
  return {
    authorized: asStringArray(bySection.get("sshAuthorizedKeys")?.metadata?.stringItems),
    knownHosts: asStringArray(bySection.get("sshKnownHosts")?.metadata?.stringItems),
  }
}

async function queueSshConfigWrite(params: {
  client: ConvexClient
  projectId: ProjectId
  ops: Array<{ path: string; value: string[] }>
  note: string
}): Promise<{ runId: Id<"runs">; jobId: Id<"jobs"> }> {
  const normalizedOps = params.ops.map((op) => ({
    path: op.path,
    valueJson: JSON.stringify(op.value),
    del: false,
  }))
  const queued = await params.client.mutation(api.controlPlane.jobs.enqueue, {
    projectId: params.projectId,
    kind: "config_write",
    title:
      normalizedOps.length === 1
        ? `config set ${normalizedOps[0]?.path || "unknown"}`
        : `config set ${normalizedOps[0]?.path || "unknown"} (+${normalizedOps.length - 1} more)`,
    payloadMeta: {
      args: ["config", "batch-set", "--ops-json", JSON.stringify(normalizedOps)],
      configPaths: normalizedOps.map((op) => op.path),
      updatedKeys: normalizedOps.map((op) => op.path),
      note: params.note,
    },
  })
  for (const op of params.ops) {
    const section = op.path === FLEET_SSH_AUTHORIZED_KEYS_PATH
      ? "sshAuthorizedKeys"
      : op.path === FLEET_SSH_KNOWN_HOSTS_PATH
        ? "sshKnownHosts"
        : null
    if (!section) continue
    await params.client.mutation(api.controlPlane.projectCredentials.upsertPending, {
      projectId: params.projectId,
      section,
      metadata: {
        status: op.value.length > 0 ? "set" : "unset",
        itemCount: op.value.length,
        stringItems: op.value,
      },
      syncStatus: "pending",
    })
  }
  return queued
}

export const addHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, host: coerceString(d["host"]) }
  })
  .handler(async ({ data }) => {
    const host = data.host.trim()
    assertSafeHostName(host)

    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const runners = await client.query(api.controlPlane.runners.listByProject, { projectId: data.projectId })
    if (!isProjectRunnerOnline(runners)) {
      throw new Error("Runner offline. Start runner first.")
    }
    const hostRows = await client.query(api.controlPlane.hosts.listByProject, { projectId: data.projectId })
    if (hostRows.some((row) => String(row?.hostName || "").trim() === host)) {
      return { ok: true as const, queued: false as const, alreadyExists: true as const }
    }

    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "config_write",
      title: `host add ${host}`,
      args: ["host", "add", "--host", host],
      note: "dashboard host add",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: HOST_ADD_SYNC_WAIT_MS,
    })
    if (terminal.status === "failed" || terminal.status === "canceled") {
      const messages = await listRunMessages({ client, runId: queued.runId, limit: 300 })
      throw new Error(terminal.errorMessage || lastErrorMessage(messages, "host add failed"))
    }
    if (terminal.status !== "succeeded") {
      return { ok: true as const, runId: queued.runId, jobId: queued.jobId, queued: true as const }
    }

    await client.mutation(api.controlPlane.hosts.upsert, {
      projectId: data.projectId,
      hostName: host,
      patch: {},
    })

    return { ok: true as const, runId: queued.runId, jobId: queued.jobId, queued: false as const }
  })

export const generateHostName = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const hostRows = await client.query(api.controlPlane.hosts.listByProject, { projectId: data.projectId })
    const existingHosts = (hostRows || [])
      .map((row) => (typeof row?.hostName === "string" ? row.hostName.trim() : ""))
      .filter(Boolean)
    return { host: generateRandomHostName({ existingHosts }) }
  })

export const addProjectSshKeys = createServerFn({ method: "POST" })
  .inputValidator(parseProjectSshKeysInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const keyText = data.keyText.trim()
    const knownHostsText = data.knownHostsText.trim()
    if (!keyText && !knownHostsText) {
      throw new Error("no ssh keys or known_hosts entries provided")
    }
    const keysFromText = keyText ? parseSshPublicKeysFromText(data.keyText) : []
    const knownHostsFromText = knownHostsText ? parseKnownHostsFromText(data.knownHostsText) : []
    if (keyText && keysFromText.length === 0) {
      throw new Error("no valid SSH public keys parsed from input")
    }
    if (knownHostsText && knownHostsFromText.length === 0) {
      throw new Error("no valid known_hosts entries parsed from input")
    }
    const { authorized: existingKeys, knownHosts: existingKnownHosts } = await readProjectSshLists({
      client,
      projectId: data.projectId,
    })
    const mergedKeys = Array.from(new Set([...existingKeys, ...keysFromText]))
    const mergedKnownHosts = Array.from(new Set([...existingKnownHosts, ...knownHostsFromText]))
    const ops: Array<{ path: string; value: string[] }> = []
    if (JSON.stringify(existingKeys) !== JSON.stringify(mergedKeys)) {
      ops.push({ path: FLEET_SSH_AUTHORIZED_KEYS_PATH, value: mergedKeys })
    }
    if (JSON.stringify(existingKnownHosts) !== JSON.stringify(mergedKnownHosts)) {
      ops.push({ path: FLEET_SSH_KNOWN_HOSTS_PATH, value: mergedKnownHosts })
    }
    if (ops.length === 0) return { ok: true as const, queued: false as const }

    const queued = await queueSshConfigWrite({
      client,
      projectId: data.projectId,
      ops,
      note: "dashboard ssh settings write",
    })
    return { ok: true as const, queued: true as const, runId: queued.runId, jobId: queued.jobId }
  })

export const removeProjectSshAuthorizedKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, key: coerceString(d["key"]) }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const key = data.key.trim()
    if (!key) throw new Error("missing key")
    const { authorized: existingKeys } = await readProjectSshLists({
      client,
      projectId: data.projectId,
    })
    if (!existingKeys.includes(key)) throw new Error("key not found")
    const nextKeys = existingKeys.filter((entry) => entry !== key)
    const queued = await queueSshConfigWrite({
      client,
      projectId: data.projectId,
      ops: [{ path: FLEET_SSH_AUTHORIZED_KEYS_PATH, value: nextKeys }],
      note: "dashboard ssh authorized_keys remove",
    })
    return { ok: true as const, queued: true as const, runId: queued.runId, jobId: queued.jobId }
  })

export const removeProjectSshKnownHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, entry: coerceString(d["entry"]) }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const entry = data.entry.trim()
    if (!entry) throw new Error("missing known_hosts entry")
    const { knownHosts: existing } = await readProjectSshLists({
      client,
      projectId: data.projectId,
    })
    if (!existing.includes(entry)) throw new Error("known_hosts entry not found")
    const nextKnownHosts = existing.filter((value) => value !== entry)
    const queued = await queueSshConfigWrite({
      client,
      projectId: data.projectId,
      ops: [{ path: FLEET_SSH_KNOWN_HOSTS_PATH, value: nextKnownHosts }],
      note: "dashboard ssh known_hosts remove",
    })
    return { ok: true as const, queued: true as const, runId: queued.runId, jobId: queued.jobId }
  })
