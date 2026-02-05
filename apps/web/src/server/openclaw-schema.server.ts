import { randomBytes } from "node:crypto"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { OpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { parseOpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { buildOpenClawGatewayConfig } from "@clawlets/core/lib/openclaw/config-invariants"
import { loadClawletsConfig } from "@clawlets/core/lib/clawlets-config"
import { compareOpenclawSchemaToNixOpenclaw, summarizeOpenclawSchemaComparison } from "@clawlets/core/lib/openclaw/schema/compare"
import { fetchNixOpenclawSourceInfo, getNixOpenclawRevFromFlakeLock } from "@clawlets/core/lib/nix-openclaw-source"
import { shellQuote, sshCapture, validateTargetHost } from "@clawlets/core/lib/ssh-remote"
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers"
import { createConvexClient } from "~/server/convex"
import { getProjectContext } from "~/sdk/repo-root"
import { sanitizeErrorMessage } from "@clawlets/core/lib/safe-error"

const SOURCE_TTL_MS = 5 * 60 * 1000
const STATUS_TTL_MS = 60 * 1000
const STATUS_FAILURE_TTL_MS = 10 * 1000
const LIVE_SCHEMA_TTL_MS = 15 * 1000
const SOURCE_CACHE_MAX = 64
const STATUS_CACHE_MAX = 128
const LIVE_SCHEMA_CACHE_MAX = 256
const SCHEMA_MARKER_BEGIN = "__OPENCLAW_SCHEMA_BEGIN__"
const SCHEMA_MARKER_END = "__OPENCLAW_SCHEMA_END__"
const SCHEMA_MARKER_BYTES_MAX = 2 * 1024 * 1024

type SourceCacheEntry = {
  expiresAt: number
  value: Awaited<ReturnType<typeof fetchNixOpenclawSourceInfo>>
}

const sourceCache = new Map<string, SourceCacheEntry>()
const sourceInFlight = new Map<string, Promise<Awaited<ReturnType<typeof fetchNixOpenclawSourceInfo>>>>()
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

async function fetchNixOpenclawSourceInfoCached(params: {
  ref: string
}): Promise<Awaited<ReturnType<typeof fetchNixOpenclawSourceInfo>>> {
  const key = params.ref.trim() || "main"
  const now = Date.now()
  pruneExpired(sourceCache, now)
  const cached = sourceCache.get(key)
  if (cached && cached.expiresAt > now) return cached.value
  const inFlight = sourceInFlight.get(key)
  if (inFlight) return inFlight
  const task = (async () => {
    const value = await fetchNixOpenclawSourceInfo({ ref: key })
    const expiresAt = Date.now() + SOURCE_TTL_MS
    sourceCache.set(key, { expiresAt, value })
    capCache(sourceCache, SOURCE_CACHE_MAX)
    return value
  })()
  sourceInFlight.set(key, task)
  void task.finally(() => sourceInFlight.delete(key))
  return task
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
  if (Buffer.byteLength(between, "utf8") > SCHEMA_MARKER_BYTES_MAX) {
    throw new Error("schema payload too large")
  }
  return between
}

export function __test_extractJsonBlock(raw: string, nonce: string): string {
  return extractJsonBlock(raw, nonce)
}

function needsSudo(targetHost: string): boolean {
  return !/^root@/i.test(targetHost.trim())
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

export async function fetchOpenclawSchemaLive(params: {
  projectId: Id<"projects">
  host: string
  gatewayId: string
}): Promise<OpenclawSchemaLiveResult> {
  const client = createConvexClient()
  const { role, repoRoot } = await getProjectContext(client, params.projectId)
  if (role !== "admin") return { ok: false as const, message: "admin required" } satisfies OpenclawSchemaLiveResult
  const gatewayId = GatewayIdSchema.parse(params.gatewayId.trim())
  const hostCandidate = String(params.host || "").trim()

  if (hostCandidate) {
    const cacheKey = `${params.projectId}:${hostCandidate}:${gatewayId}`
    const now = Date.now()
    pruneExpired(liveSchemaCache, now)
    const cached = liveSchemaCache.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.value
  }

  const { config } = loadClawletsConfig({ repoRoot })

  const host = hostCandidate || config.defaultHost || ""
  if (!host) throw new Error("missing host")
  if (!config.hosts[host]) throw new Error(`unknown host: ${host}`)
  if (!(config.hosts as any)?.[host]?.gateways?.[gatewayId]) throw new Error(`unknown gateway: ${gatewayId}`)

  const cacheKey = `${params.projectId}:${host}:${gatewayId}`
  const now = Date.now()
  pruneExpired(liveSchemaCache, now)
  const cached = liveSchemaCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value

  const targetHostRaw = String((config.hosts[host] as any)?.targetHost || "").trim()
  if (!targetHostRaw) {
    throw new Error(
      `missing targetHost for ${host}. Set hosts.${host}.targetHost (Hosts → Settings → Target host), save, reload.`,
    )
  }
  const targetHost = validateTargetHost(targetHostRaw)

  const gatewayConfig = buildOpenClawGatewayConfig({ config, hostName: host, gatewayId })
  const gateway = (gatewayConfig.invariants as any)?.gateway || {}
  const port = typeof gateway.port === "number" ? gateway.port : Number(gateway.port || 0)
  if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid gateway port for gateway ${gatewayId}`)

  const inFlight = liveSchemaInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      await client.mutation(api.projects.guardLiveSchemaFetch, { projectId: params.projectId, host, gatewayId })

      const nonce = randomBytes(8).toString("hex")
      const remoteCmd = buildGatewaySchemaCommand({ gatewayId, port, sudo: needsSudo(targetHost), nonce })
      const raw = await sshCapture(targetHost, remoteCmd, {
        cwd: repoRoot,
        timeoutMs: 15_000,
        maxOutputBytes: 5 * 1024 * 1024,
      })
      const payload = extractJsonBlock(raw || "", nonce)
      const parsed = JSON.parse(payload)
      const artifact = parseOpenclawSchemaArtifact(parsed)
      if (!artifact.ok) {
        throw new Error(artifact.error)
      }
      const result = { ok: true as const, schema: artifact.value } satisfies OpenclawSchemaLiveResult
      const expiresAt = Date.now() + LIVE_SCHEMA_TTL_MS
      liveSchemaCache.set(cacheKey, { expiresAt, value: result })
      capCache(liveSchemaCache, LIVE_SCHEMA_CACHE_MAX)
      return result
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema. Check gateway and host settings.")
      console.error("openclaw schema live failed", message)
      const result = { ok: false as const, message } satisfies OpenclawSchemaLiveResult
      const expiresAt = Date.now() + LIVE_SCHEMA_TTL_MS
      liveSchemaCache.set(cacheKey, { expiresAt, value: result })
      capCache(liveSchemaCache, LIVE_SCHEMA_CACHE_MAX)
      return result
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
  const now = Date.now()
  pruneExpired(statusCache, now)
  const cached = statusCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value
  const inFlight = statusInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const task = (async () => {
    try {
      const client = createConvexClient()
      const { repoRoot } = await getProjectContext(client, params.projectId)
      const comparison = await compareOpenclawSchemaToNixOpenclaw({
        repoRoot,
        fetchNixOpenclawSourceInfo: fetchNixOpenclawSourceInfoCached,
        getNixOpenclawRevFromFlakeLock,
        requireSchemaRev: false,
      })
      if (!comparison) {
        const result = {
          ok: true as const,
          warnings: ["openclaw schema revision unavailable"],
        } satisfies OpenclawSchemaStatusResult
        const expiresAt = Date.now() + STATUS_TTL_MS
        statusCache.set(cacheKey, { expiresAt, value: result })
        capCache(statusCache, STATUS_CACHE_MAX)
        return result
      }

      const summary = summarizeOpenclawSchemaComparison(comparison)
      const pinned = summary.pinned?.ok
        ? { nixOpenclawRev: summary.pinned.nixOpenclawRev, openclawRev: summary.pinned.openclawRev }
        : undefined
      const upstream = summary.upstream.ok
        ? { nixOpenclawRef: summary.upstream.nixOpenclawRef, openclawRev: summary.upstream.openclawRev }
        : undefined

      const result = {
        ok: true as const,
        pinned,
        upstream,
        warnings: summary.warnings.length > 0 ? summary.warnings : undefined,
      } satisfies OpenclawSchemaStatusResult
      const expiresAt = Date.now() + STATUS_TTL_MS
      statusCache.set(cacheKey, { expiresAt, value: result })
      capCache(statusCache, STATUS_CACHE_MAX)
      return result
    } catch (err) {
      const message = sanitizeErrorMessage(err, "Unable to fetch schema status. Check logs.")
      if (process.env.NODE_ENV === "development") {
        console.error("openclaw schema status failed", message, err)
      } else {
        console.error("openclaw schema status failed", message)
      }
      const result = { ok: false as const, message } satisfies OpenclawSchemaStatusResult
      const expiresAt = Date.now() + STATUS_FAILURE_TTL_MS
      statusCache.set(cacheKey, { expiresAt, value: result })
      capCache(statusCache, STATUS_CACHE_MAX)
      return result
    }
  })()

  statusInFlight.set(cacheKey, task)
  void task.finally(() => statusInFlight.delete(cacheKey))
  return task
}
