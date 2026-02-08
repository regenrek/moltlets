import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { OpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { parseOpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { shellQuote } from "@clawlets/core/lib/security/ssh-remote"
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseLastJsonMessage,
  waitForRunTerminal,
} from "~/sdk/runtime"

const STATUS_TTL_MS = 60 * 1000
const STATUS_FAILURE_TTL_MS = 10 * 1000
const LIVE_SCHEMA_TTL_MS = 15 * 1000
const STATUS_CACHE_MAX = 128
const LIVE_SCHEMA_CACHE_MAX = 256
const SCHEMA_MARKER_BEGIN = "__OPENCLAW_SCHEMA_BEGIN__"
const SCHEMA_MARKER_END = "__OPENCLAW_SCHEMA_END__"
const LIVE_SCHEMA_MAX_OUTPUT_BYTES = 5 * 1024 * 1024
const SCHEMA_MARKER_OVERHEAD_BYTES = 16 * 1024
const SCHEMA_PAYLOAD_BYTES_MAX = LIVE_SCHEMA_MAX_OUTPUT_BYTES - SCHEMA_MARKER_OVERHEAD_BYTES

const statusCache = new Map<string, { expiresAt: number; value: OpenclawSchemaStatusResult }>()
const statusInFlight = new Map<string, Promise<OpenclawSchemaStatusResult>>()
const liveSchemaCache = new Map<string, { expiresAt: number; value: OpenclawSchemaLiveResult }>()
const liveSchemaInFlight = new Map<string, Promise<OpenclawSchemaLiveResult>>()

function pruneExpired<T extends { expiresAt: number }>(cache: Map<string, T>, now: number) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

function capCache<T>(cache: Map<string, T>, maxSize: number) {
  if (cache.size <= maxSize) return
  const overflow = cache.size - maxSize
  let removed = 0
  for (const key of cache.keys()) {
    cache.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

function extractJsonBlock(raw: string, nonce: string): string {
  const begin = `${SCHEMA_MARKER_BEGIN}${nonce}__`
  const end = `${SCHEMA_MARKER_END}${nonce}__`
  const beginIndex = raw.indexOf(begin)
  if (beginIndex === -1) throw new Error("missing schema markers in output")
  const beginIsLineStart =
    beginIndex === 0 || raw[beginIndex - 1] === "\n" || raw[beginIndex - 1] === "\r"
  if (!beginIsLineStart) throw new Error("missing schema markers in output")
  const beginLineEnd = raw.indexOf("\n", beginIndex)
  if (beginLineEnd === -1) throw new Error("missing schema markers in output")

  let endLineStart = raw.indexOf(`\n${end}`, beginLineEnd)
  if (endLineStart === -1) throw new Error("missing schema markers in output")
  endLineStart += 1
  const endLineEnd = raw.indexOf("\n", endLineStart)
  const endLine = raw.slice(endLineStart, endLineEnd === -1 ? raw.length : endLineEnd).replace(/\r$/, "")
  if (endLine !== end) throw new Error("missing schema markers in output")

  let payloadEnd = endLineStart - 1
  if (payloadEnd > beginLineEnd && raw[payloadEnd - 1] === "\r") payloadEnd -= 1
  const between = raw.slice(beginLineEnd + 1, payloadEnd).trim()
  if (!between) throw new Error("empty schema payload in output")
  const payloadBytes = Buffer.byteLength(between, "utf8")
  if (payloadBytes > SCHEMA_PAYLOAD_BYTES_MAX) {
    throw new Error(`schema payload too large: ${payloadBytes} bytes (max ${SCHEMA_PAYLOAD_BYTES_MAX} bytes)`)
  }
  return between
}

export function __test_extractJsonBlock(raw: string, nonce: string): string {
  return extractJsonBlock(raw, nonce)
}

function buildGatewaySchemaCommand(params: {
  gatewayId: string
  port: number
  sudo: boolean
  nonce: string
}): string {
  const envFile = `/srv/openclaw/${params.gatewayId}/credentials/gateway.env`
  const url = `ws://127.0.0.1:${params.port}`
  const begin = `${SCHEMA_MARKER_BEGIN}${params.nonce}__`
  const end = `${SCHEMA_MARKER_END}${params.nonce}__`
  const beginQuoted = shellQuote(begin)
  const endQuoted = shellQuote(end)
  const envFileQuoted = shellQuote(envFile)
  const tokenName = "OPENCLAW_GATEWAY_TOKEN"
  const script = [
    "set -euo pipefail",
    `token=\"$(awk -F= '$1==\"${tokenName}\"{print substr($0,length($1)+2); exit}' ${envFileQuoted})\"`,
    'token="${token%$"\\r"}"',
    `if [ -z \"$token\" ]; then echo "missing ${tokenName}" >&2; exit 2; fi`,
    `printf '%s\\n' ${beginQuoted}`,
    `env ${tokenName}="$token" openclaw gateway call config.schema --url ${url} --json`,
    `printf '%s\\n' ${endQuoted}`,
  ].join(" && ")
  const args = [
    ...(params.sudo ? ["sudo", "-n", "-u", `gateway-${params.gatewayId}`] : []),
    "bash",
    "-lc",
    script,
  ]
  return args.map((a) => shellQuote(a)).join(" ")
}

export function __test_buildGatewaySchemaCommand(params: {
  gatewayId: string
  port: number
  sudo: boolean
  nonce: string
}): string {
  return buildGatewaySchemaCommand(params)
}

export type OpenclawSchemaLiveResult =
  | { ok: true; schema: OpenclawSchemaArtifact }
  | { ok: false; message: string }

export type OpenclawSchemaStatusResult =
  | {
      ok: true
      pinned?: { nixOpenclawRev: string; openclawRev: string }
      upstream?: { nixOpenclawRef: string; openclawRev: string }
      warnings?: string[]
    }
  | { ok: false; message: string }

function parseRunnerJson(messages: string[]): Record<string, unknown> | null {
  const direct = parseLastJsonMessage<Record<string, unknown>>(messages)
  if (direct) return direct
  for (let i = messages.length - 1; i >= 0; i--) {
    const raw = String(messages[i] || "").trim()
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
  host?: string
  title: string
  args: string[]
  timeoutMs: number
}): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; message: string }> {
  const client = createConvexClient()
  const queued = await enqueueRunnerCommand({
    client,
    projectId: params.projectId,
    runKind: "custom",
    title: params.title,
    host: params.host,
    args: params.args,
    note: "runner queued from openclaw schema endpoint",
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
    return {
      ok: false as const,
      message: terminal.errorMessage || lastErrorMessage(messages, "runner command failed"),
    }
  }
  const parsed = parseRunnerJson(messages)
  if (!parsed) {
    return { ok: false as const, message: "runner output missing JSON payload" }
  }
  return { ok: true as const, json: parsed }
}

export async function fetchOpenclawSchemaLive(params: {
  projectId: Id<"projects">
  host: string
  gatewayId: string
}): Promise<OpenclawSchemaLiveResult> {
  const host = String(params.host || "").trim()
  if (!host) throw new Error("missing host")
  const gatewayId = GatewayIdSchema.parse(String(params.gatewayId || "").trim())
  const cacheKey = `${params.projectId}:${host}:${gatewayId}`

  const client = createConvexClient()
  try {
    await requireAdminProjectAccess(client, params.projectId)
  } catch (err) {
    const message = sanitizeErrorMessage(err, "admin required")
    return { ok: false as const, message }
  }

  const now = Date.now()
  pruneExpired(liveSchemaCache, now)
  const cached = liveSchemaCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value

  const inFlight = liveSchemaInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      await client.mutation(api.projects.guardLiveSchemaFetch, {
        projectId: params.projectId,
        host,
        gatewayId,
      })
      const result = await runRunnerJsonCommand({
        projectId: params.projectId,
        host,
        title: `OpenClaw schema live (${host} · ${gatewayId})`,
        args: [
          "openclaw",
          "schema",
          "fetch",
          "--host",
          host,
          "--gateway",
          gatewayId,
          "--ssh-tty=false",
        ],
        timeoutMs: 20_000,
      })
      if (!result.ok) {
        throw new Error(result.message || "runner schema fetch failed")
      }
      const artifact = parseOpenclawSchemaArtifact(result.json)
      if (!artifact.ok) {
        throw new Error(artifact.error)
      }
      const okResult = { ok: true as const, schema: artifact.value } satisfies OpenclawSchemaLiveResult
      const expiresAt = Date.now() + LIVE_SCHEMA_TTL_MS
      liveSchemaCache.set(cacheKey, { expiresAt, value: okResult })
      capCache(liveSchemaCache, LIVE_SCHEMA_CACHE_MAX)
      return okResult
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema. Check gateway and host settings.")
      const failResult = { ok: false as const, message } satisfies OpenclawSchemaLiveResult
      const expiresAt = Date.now() + LIVE_SCHEMA_TTL_MS
      liveSchemaCache.set(cacheKey, { expiresAt, value: failResult })
      capCache(liveSchemaCache, LIVE_SCHEMA_CACHE_MAX)
      return failResult
    }
  })()

  liveSchemaInFlight.set(cacheKey, task)
  void task.finally(() => liveSchemaInFlight.delete(cacheKey))
  return task
}

export async function fetchOpenclawSchemaStatus(params: {
  projectId: Id<"projects">
}): Promise<OpenclawSchemaStatusResult> {
  const cacheKey = String(params.projectId)
  const client = createConvexClient()
  try {
    await requireAdminProjectAccess(client, params.projectId)
  } catch (err) {
    const message = sanitizeErrorMessage(err, "admin required")
    return { ok: false as const, message }
  }

  const now = Date.now()
  pruneExpired(statusCache, now)
  const cached = statusCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value
  const inFlight = statusInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      const result = await runRunnerJsonCommand({
        projectId: params.projectId,
        title: "OpenClaw schema status",
        args: ["openclaw", "schema", "status", "--json"],
        timeoutMs: 25_000,
      })
      if (!result.ok) {
        throw new Error(result.message || "runner schema status failed")
      }
      const row = result.json
      if (row.ok !== true) {
        const message = typeof row.message === "string" && row.message.trim()
          ? row.message.trim()
          : "Unable to fetch schema status. Check logs."
        throw new Error(message)
      }
      const okResult = {
        ok: true as const,
        pinned: row.pinned as OpenclawSchemaStatusResult extends { pinned?: infer P } ? P : never,
        upstream: row.upstream as OpenclawSchemaStatusResult extends { upstream?: infer U } ? U : never,
        warnings: Array.isArray(row.warnings)
          ? row.warnings.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : undefined,
      } satisfies OpenclawSchemaStatusResult
      const expiresAt = Date.now() + STATUS_TTL_MS
      statusCache.set(cacheKey, { expiresAt, value: okResult })
      capCache(statusCache, STATUS_CACHE_MAX)
      return okResult
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema status. Check logs.")
      const failResult = { ok: false as const, message } satisfies OpenclawSchemaStatusResult
      const expiresAt = Date.now() + STATUS_FAILURE_TTL_MS
      statusCache.set(cacheKey, { expiresAt, value: failResult })
      capCache(statusCache, STATUS_CACHE_MAX)
      return failResult
    }
  })()

  statusInFlight.set(cacheKey, task)
  void task.finally(() => statusInFlight.delete(cacheKey))
  return task
}
