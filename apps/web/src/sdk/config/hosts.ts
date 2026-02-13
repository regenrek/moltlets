import { createServerFn } from "@tanstack/react-start"
import {
  assertSafeHostName,
} from "@clawlets/core/lib/config/clawlets-config"
import { generateHostName as generateRandomHostName } from "@clawlets/core/lib/host/host-name-generator"
import { parseSshPublicKeysFromText } from "@clawlets/core/lib/security/ssh"
import { parseKnownHostsFromText } from "@clawlets/core/lib/security/ssh-files"
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
import { configDotBatch, configDotGet, configDotSet } from "./dot"

const HOST_ADD_SYNC_WAIT_MS = 8_000

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => coerceTrimmedString(entry)).filter(Boolean)
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
    const [existingKeysNode, existingKnownHostsNode] = await Promise.all([
      configDotGet({ data: { projectId: data.projectId, path: "fleet.sshAuthorizedKeys" } }),
      configDotGet({ data: { projectId: data.projectId, path: "fleet.sshKnownHosts" } }),
    ])
    const existingKeys = asStringArray(existingKeysNode.value)
    const existingKnownHosts = asStringArray(existingKnownHostsNode.value)
    const mergedKeys = Array.from(new Set([...existingKeys, ...keysFromText]))
    const mergedKnownHosts = Array.from(new Set([...existingKnownHosts, ...knownHostsFromText]))

    return await configDotBatch({
      data: {
        projectId: data.projectId,
        ops: [
          { path: "fleet.sshAuthorizedKeys", valueJson: JSON.stringify(mergedKeys), del: false },
          { path: "fleet.sshKnownHosts", valueJson: JSON.stringify(mergedKnownHosts), del: false },
        ],
      },
    })
  })

export const removeProjectSshAuthorizedKey = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, key: coerceString(d["key"]) }
  })
  .handler(async ({ data }) => {
    const key = data.key.trim()
    if (!key) throw new Error("missing key")
    const node = await configDotGet({
      data: { projectId: data.projectId, path: "fleet.sshAuthorizedKeys" },
    })
    const existingKeys = asStringArray(node.value)
    if (!existingKeys.includes(key)) throw new Error("key not found")
    return await configDotSet({
      data: {
        projectId: data.projectId,
        path: "fleet.sshAuthorizedKeys",
        valueJson: JSON.stringify(existingKeys.filter((entry) => entry !== key)),
      },
    })
  })

export const removeProjectSshKnownHost = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, entry: coerceString(d["entry"]) }
  })
  .handler(async ({ data }) => {
    const entry = data.entry.trim()
    if (!entry) throw new Error("missing known_hosts entry")
    const node = await configDotGet({
      data: { projectId: data.projectId, path: "fleet.sshKnownHosts" },
    })
    const existing = asStringArray(node.value)
    if (!existing.includes(entry)) throw new Error("known_hosts entry not found")
    return await configDotSet({
      data: {
        projectId: data.projectId,
        path: "fleet.sshKnownHosts",
        valueJson: JSON.stringify(existing.filter((value) => value !== entry)),
      },
    })
  })
