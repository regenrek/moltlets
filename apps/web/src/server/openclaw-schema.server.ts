import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { OpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { parseOpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { resolveCommandSpecForKind } from "@clawlets/core/lib/runtime/runner-command-policy-args"
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  takeRunnerCommandResultBlobObject,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"

const STATUS_TTL_MS = 60 * 1000
const STATUS_FAILURE_TTL_MS = 10 * 1000
const LIVE_SCHEMA_TTL_MS = 15 * 1000
const STATUS_CACHE_MAX = 128
const LIVE_SCHEMA_CACHE_MAX = 256

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

function resolveStructuredCommandResultMode(args: string[]): "small" | "large" | null {
  const resolved = resolveCommandSpecForKind("custom", args)
  if (!resolved.ok) return null
  if (resolved.spec.resultMode === "json_small") return "small"
  if (resolved.spec.resultMode === "json_large") return "large"
  return null
}

export function __test_resolveStructuredCommandResultMode(args: string[]): "small" | "large" | null {
  return resolveStructuredCommandResultMode(args)
}

async function runRunnerJsonCommand(params: {
  projectId: Id<"projects">
  host?: string
  title: string
  args: string[]
  timeoutMs: number
}): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; message: string }> {
  const commandResultMode = resolveStructuredCommandResultMode(params.args)
  if (!commandResultMode) {
    return {
      ok: false as const,
      message: "runner command is not configured for structured JSON results",
    }
  }
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
  const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId, limit: 300 })
  if (terminal.status !== "succeeded") {
    return {
      ok: false as const,
      message: terminal.errorMessage || lastErrorMessage(messages, "runner command failed"),
    }
  }
  const parsed = commandResultMode === "small"
    ? await takeRunnerCommandResultObject({
        client,
        projectId: params.projectId,
        jobId: queued.jobId,
        runId: queued.runId,
      })
    : await takeRunnerCommandResultBlobObject({
        client,
        projectId: params.projectId,
        jobId: queued.jobId,
        runId: queued.runId,
      })
  if (!parsed) {
    return {
      ok: false as const,
      message: "runner command result missing JSON payload",
    }
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
      await client.mutation(api.controlPlane.projects.guardLiveSchemaFetch, {
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
