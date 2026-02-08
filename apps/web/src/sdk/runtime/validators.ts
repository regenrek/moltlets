import { GatewayIdSchema, HostNameSchema } from "@clawlets/shared/lib/identifiers"

import type { SystemTableNames } from "convex/server"
import type { Id, TableNames } from "../../../convex/_generated/dataModel"
import { coerceTrimmedString } from "./strings"

export const SERVER_CHANNEL_OPS = ["status", "capabilities", "login", "logout"] as const
export type ServerChannelOp = (typeof SERVER_CHANNEL_OPS)[number]
export const CAPABILITY_PRESET_KINDS = ["channel", "model", "security", "plugin"] as const
export type CapabilityPresetKind = (typeof CAPABILITY_PRESET_KINDS)[number]

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid input")
  return value as Record<string, unknown>
}

function parseConvexId<TTable extends TableNames | SystemTableNames>(value: unknown, name: string): Id<TTable> {
  if (typeof value !== "string") throw new Error(`invalid ${name}`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`invalid ${name}`)
  return trimmed as Id<TTable>
}

function parseOptionalHostName(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  return HostNameSchema.parse(trimmed)
}

function parseHostNameRequired(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid host")
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid host")
  return HostNameSchema.parse(trimmed)
}

function parseGatewayIdRequired(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid gatewayId")
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid gatewayId")
  return GatewayIdSchema.parse(trimmed)
}

function parseServerChannelOp(value: unknown): ServerChannelOp {
  if (typeof value !== "string") throw new Error("invalid op")
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid op")
  if (!SERVER_CHANNEL_OPS.includes(trimmed as ServerChannelOp)) throw new Error("invalid op")
  return trimmed as ServerChannelOp
}

function parseCapabilityPresetKind(value: unknown): CapabilityPresetKind {
  if (typeof value !== "string") throw new Error("invalid preset kind")
  const trimmed = value.trim()
  if (!trimmed) throw new Error("invalid preset kind")
  if (!CAPABILITY_PRESET_KINDS.includes(trimmed as CapabilityPresetKind)) throw new Error("invalid preset kind")
  return trimmed as CapabilityPresetKind
}

function parseOptionalString(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length > maxLen) throw new Error("invalid input")
  return trimmed
}

function parseLines(value: unknown): string {
  if (typeof value !== "string") return "200"
  const trimmed = value.trim()
  if (!trimmed) return "200"
  if (!/^[0-9]+$/.test(trimmed)) throw new Error("invalid lines")
  return trimmed
}

function parseTimeoutMs(value: unknown): number {
  if (value === undefined || value === null || value === "") return 10_000
  const s = coerceTrimmedString(value)
  if (!s) return 10_000
  if (!/^[0-9]+$/.test(s)) throw new Error("invalid timeout")
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n)) throw new Error("invalid timeout")
  if (n < 1000 || n > 120_000) throw new Error("invalid timeout")
  return n
}

export function parseServerChannelsStartInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  gatewayId: string
  op: ServerChannelOp
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseOptionalHostName(d["host"]),
    gatewayId: parseGatewayIdRequired(d["gatewayId"]),
    op: parseServerChannelOp(d["op"]),
  }
}

export function parseServerChannelsExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  gatewayId: string
  op: ServerChannelOp
  channel: string
  account: string
  target: string
  timeoutMs: number
  json: boolean
  probe: boolean
  verbose: boolean
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    runId: parseConvexId(d["runId"], "runId"),
    host: parseOptionalHostName(d["host"]),
    gatewayId: parseGatewayIdRequired(d["gatewayId"]),
    op: parseServerChannelOp(d["op"]),
    channel: parseOptionalString(d["channel"], 64),
    account: parseOptionalString(d["account"], 64),
    target: parseOptionalString(d["target"], 128),
    timeoutMs: parseTimeoutMs(d["timeout"]),
    json: Boolean(d["json"]),
    probe: Boolean(d["probe"]),
    verbose: Boolean(d["verbose"]),
  }
}

export function parseProjectHostInput(data: unknown): { projectId: Id<"projects">; host: string } {
  const d = requireObject(data)
  return { projectId: parseConvexId(d["projectId"], "projectId"), host: parseOptionalHostName(d["host"]) }
}

function parseSecretsScope(value: unknown): "bootstrap" | "updates" | "openclaw" | "all" {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return "all"
  if (raw === "bootstrap" || raw === "updates" || raw === "openclaw" || raw === "all") return raw
  throw new Error("invalid scope (expected bootstrap|updates|openclaw|all)")
}

export function parseProjectHostScopeInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  scope: "bootstrap" | "updates" | "openclaw" | "all"
} {
  const base = parseProjectHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    scope: parseSecretsScope(d["scope"]),
  }
}

export function parseProjectIdInput(data: unknown): { projectId: Id<"projects"> } {
  const d = requireObject(data)
  return { projectId: parseConvexId(d["projectId"], "projectId") }
}

export function parseProjectHostRequiredInput(data: unknown): { projectId: Id<"projects">; host: string } {
  const d = requireObject(data)
  return { projectId: parseConvexId(d["projectId"], "projectId"), host: parseHostNameRequired(d["host"]) }
}

export function parseProjectSshKeysInput(data: unknown): {
  projectId: Id<"projects">
  keyText: string
  knownHostsText: string
} {
  const d = requireObject(data)
  const keyFilePath = typeof d["keyFilePath"] === "string" ? d["keyFilePath"].trim() : ""
  const knownHostsFilePath = typeof d["knownHostsFilePath"] === "string" ? d["knownHostsFilePath"].trim() : ""
  if (keyFilePath || knownHostsFilePath) {
    throw new Error("file path imports are disabled; paste or upload keys instead")
  }
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    keyText: parseOptionalString(d["keyText"], 64 * 1024),
    knownHostsText: parseOptionalString(d["knownHostsText"], 256 * 1024),
  }
}

export function parseProjectHostGatewayInput(data: unknown): { projectId: Id<"projects">; host: string; gatewayId: string } {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    gatewayId: parseGatewayIdRequired(d["gatewayId"]),
  }
}

export function parseProjectGatewayInput(data: unknown): { projectId: Id<"projects">; host: string; gatewayId: string } {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    gatewayId: parseGatewayIdRequired(d["gatewayId"]),
  }
}

export function parseGatewayCapabilityPresetInput(data: unknown): {
  projectId: Id<"projects">
  gatewayId: string
  host: string
  kind: CapabilityPresetKind
  presetId: string
  schemaMode: "live" | "pinned"
} {
  const d = requireObject(data)
  let schemaMode: "live" | "pinned" = "pinned"
  if (typeof d["schemaMode"] === "string") {
    const trimmed = d["schemaMode"].trim()
    if (trimmed === "live") schemaMode = "live"
  }
  const presetId = parseOptionalString(d["presetId"], 128)
  if (!presetId) throw new Error("invalid presetId")
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    gatewayId: parseGatewayIdRequired(d["gatewayId"]),
    host: parseHostNameRequired(d["host"]),
    kind: parseCapabilityPresetKind(d["kind"]),
    presetId,
    schemaMode,
  }
}

export function parseGatewayCapabilityPresetPreviewInput(data: unknown): {
  projectId: Id<"projects">
  gatewayId: string
  host: string
  kind: CapabilityPresetKind
  presetId: string
} {
  const d = requireObject(data)
  const presetId = parseOptionalString(d["presetId"], 128)
  if (!presetId) throw new Error("invalid presetId")
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    gatewayId: parseGatewayIdRequired(d["gatewayId"]),
    host: parseHostNameRequired(d["host"]),
    kind: parseCapabilityPresetKind(d["kind"]),
    presetId,
  }
}

export function parseGatewayOpenclawConfigInput(data: unknown): {
  projectId: Id<"projects">
  gatewayId: string
  host: string
  schemaMode: "live" | "pinned"
  openclaw: unknown
} {
  const d = requireObject(data)
  let schemaMode: "live" | "pinned" = "pinned"
  if (typeof d["schemaMode"] === "string") {
    const trimmed = d["schemaMode"].trim()
    if (trimmed) {
      if (trimmed !== "live" && trimmed !== "pinned") throw new Error("invalid schemaMode")
      schemaMode = trimmed as "live" | "pinned"
    }
  }
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    gatewayId: parseGatewayIdRequired(d["gatewayId"]),
    host: parseHostNameRequired(d["host"]),
    schemaMode,
    openclaw: d["openclaw"],
  }
}

export function parseProjectRunHostInput(data: unknown): { projectId: Id<"projects">; runId: Id<"runs">; host: string } {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    runId: parseConvexId(d["runId"], "runId"),
    host: parseHostNameRequired(d["host"]),
  }
}

export function parseProjectRunHostScopeInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  scope: "bootstrap" | "updates" | "openclaw" | "all"
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    scope: parseSecretsScope(d["scope"]),
  }
}

export function parseProjectHostTargetInput(data: unknown): { projectId: Id<"projects">; host: string; targetHost: string } {
  const base = parseProjectHostRequiredInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseProjectRunHostConfirmInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  confirm: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    confirm: typeof d["confirm"] === "string" ? d["confirm"] : "",
  }
}

export function parseServerStatusStartInput(data: unknown): { projectId: Id<"projects">; host: string } {
  return parseProjectHostRequiredInput(data)
}

export function parseServerStatusExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerAuditStartInput(data: unknown): { projectId: Id<"projects">; host: string } {
  return parseProjectHostRequiredInput(data)
}

export function parseServerAuditExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerLogsStartInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  unit: string
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    unit: parseOptionalString(d["unit"], 256),
  }
}

export function parseServerLogsExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  unit: string
  lines: string
  since: string
  follow: boolean
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    unit: parseOptionalString(d["unit"], 256),
    lines: parseLines(d["lines"]),
    since: parseOptionalString(d["since"], 256),
    follow: Boolean(d["follow"]),
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerUpdateStatusStartInput(data: unknown): { projectId: Id<"projects">; host: string } {
  return parseProjectHostRequiredInput(data)
}

export function parseServerUpdateStatusExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerUpdateLogsStartInput(data: unknown): { projectId: Id<"projects">; host: string } {
  return parseProjectHostRequiredInput(data)
}

export function parseServerUpdateLogsExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  lines: string
  since: string
  follow: boolean
  targetHost: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    lines: parseLines(d["lines"]),
    since: parseOptionalString(d["since"], 256),
    follow: Boolean(d["follow"]),
    targetHost: parseOptionalString(d["targetHost"], 512),
  }
}

export function parseServerUpdateApplyStartInput(data: unknown): { projectId: Id<"projects">; host: string } {
  return parseProjectHostRequiredInput(data)
}

export function parseServerUpdateApplyExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  targetHost: string
  confirm: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    targetHost: parseOptionalString(d["targetHost"], 512),
    confirm: typeof d["confirm"] === "string" ? d["confirm"] : "",
  }
}

export function parseServerRestartStartInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  unit: string
} {
  const d = requireObject(data)
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    unit: parseOptionalString(d["unit"], 256),
  }
}

export function parseServerRestartExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  unit: string
  targetHost: string
  confirm: string
} {
  const base = parseProjectRunHostInput(data)
  const d = requireObject(data)
  return {
    ...base,
    unit: parseOptionalString(d["unit"], 256),
    targetHost: parseOptionalString(d["targetHost"], 512),
    confirm: typeof d["confirm"] === "string" ? d["confirm"] : "",
  }
}

export function parseSecretsInitExecuteInput(data: unknown): {
  projectId: Id<"projects">
  runId: Id<"runs">
  host: string
  scope: "bootstrap" | "updates" | "openclaw" | "all"
  allowPlaceholders: boolean
  secretNames: string[]
} {
  const base = parseProjectRunHostScopeInput(data)
  const d = requireObject(data)
  return {
    ...base,
    allowPlaceholders: Boolean(d["allowPlaceholders"]),
    secretNames: parseSecretNameList(d["secrets"]),
  }
}

export function parseWriteHostSecretsInput(data: unknown): {
  projectId: Id<"projects">
  host: string
  secretNames: string[]
} {
  const d = requireObject(data)
  if (!d["secrets"] || typeof d["secrets"] !== "object" || Array.isArray(d["secrets"])) {
    throw new Error("invalid secrets")
  }
  return {
    projectId: parseConvexId(d["projectId"], "projectId"),
    host: parseHostNameRequired(d["host"]),
    secretNames: parseSecretNameList(d["secrets"]),
  }
}

function parseSecretNameList(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid secrets");
  const names = Object.keys(input as Record<string, unknown>)
    .map((name) => name.trim())
    .filter(Boolean);
  return Array.from(new Set(names));
}
