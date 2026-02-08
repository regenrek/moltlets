import { createServerFn } from "@tanstack/react-start"
import {
  assertSafeHostName,
} from "@clawlets/core/lib/config/clawlets-config"
import { generateHostName as generateRandomHostName } from "@clawlets/core/lib/host/host-name-generator"
import { parseSshPublicKeysFromText } from "@clawlets/core/lib/security/ssh"
import { parseKnownHostsFromText } from "@clawlets/core/lib/security/ssh-files"
import { coerceString, coerceTrimmedString, parseProjectIdInput, parseProjectSshKeysInput } from "~/sdk/runtime"
import { configDotBatch, configDotGet, configDotSet } from "./dot"

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

    const hostsNode = await configDotGet({
      data: { projectId: data.projectId, path: "hosts" },
    })
    const hosts =
      hostsNode.value && typeof hostsNode.value === "object" && !Array.isArray(hostsNode.value)
        ? (hostsNode.value as Record<string, unknown>)
        : {}
    if (Object.prototype.hasOwnProperty.call(hosts, host)) return { ok: true as const }

    const defaultHostNode = await configDotGet({
      data: { projectId: data.projectId, path: "defaultHost" },
    })
    const hasDefaultHost = typeof defaultHostNode.value === "string" && defaultHostNode.value.trim().length > 0
    const ops = [
      { path: `hosts.${host}`, valueJson: "{}", del: false },
      ...(hasDefaultHost ? [] : [{ path: "defaultHost", value: host, del: false }]),
    ]
    return await configDotBatch({
      data: { projectId: data.projectId, ops },
    })
  })

export const generateHostName = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    const hostsNode = await configDotGet({
      data: { projectId: data.projectId, path: "hosts" },
    })
    const hosts =
      hostsNode.value && typeof hostsNode.value === "object" && !Array.isArray(hostsNode.value)
        ? Object.keys(hostsNode.value as Record<string, unknown>)
        : []
    return { host: generateRandomHostName({ existingHosts: hosts }) }
  })

export const addProjectSshKeys = createServerFn({ method: "POST" })
  .inputValidator(parseProjectSshKeysInput)
  .handler(async ({ data }) => {
    if (!data.keyText.trim() && !data.knownHostsText.trim()) {
      throw new Error("no ssh keys or known_hosts entries provided")
    }
    const keysFromText = data.keyText.trim() ? parseSshPublicKeysFromText(data.keyText) : []
    const knownHostsFromText = data.knownHostsText.trim() ? parseKnownHostsFromText(data.knownHostsText) : []
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
