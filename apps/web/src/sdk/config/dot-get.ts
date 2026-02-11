import { createServerFn } from "@tanstack/react-start"
import { splitDotPath } from "@clawlets/core/lib/storage/dot-path"
import { getAtPath } from "@clawlets/core/lib/storage/object-path"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  coerceString,
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseProjectIdInput,
  takeRunnerCommandResultBlobObject,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"

export type ConfigDotMultiGetResponse = {
  values: Record<string, any>
}

export type ConfigDotGetResponse = {
  path: string
  value: any
}

const CONFIG_DOT_MULTI_GET_MAX_PATHS = 100

function normalizeDotPath(path: string): string {
  return splitDotPath(path).join(".")
}

function parseMultiGetPaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("missing paths")
  if (value.length < 1) throw new Error("missing paths")
  if (value.length > CONFIG_DOT_MULTI_GET_MAX_PATHS) {
    throw new Error(`too many paths (max ${CONFIG_DOT_MULTI_GET_MAX_PATHS})`)
  }
  const deduped: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < value.length; i += 1) {
    const raw = coerceString(value[i]).trim()
    if (!raw) throw new Error(`missing path at index ${i}`)
    const normalized = normalizeDotPath(raw)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    deduped.push(normalized)
  }
  return deduped
}

export const configDotMultiGet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, paths: parseMultiGetPaths(d["paths"]) }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: data.paths.length === 1 ? `config show (${data.paths[0]})` : `config show (${data.paths.length} paths)`,
      args: ["config", "show", "--pretty", "false"],
      note: "control-plane config read (multi-get)",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 30_000,
    })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId })
    if (terminal.status !== "succeeded") {
      throw new Error(terminal.errorMessage || lastErrorMessage(messages, "config read failed"))
    }

    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    }) ?? await takeRunnerCommandResultBlobObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (!parsed) {
      throw new Error("config read command result missing JSON payload (payload may exceed runner result limits)")
    }

    const values: Record<string, any> = {}
    for (const path of data.paths) {
      values[path] = getAtPath(parsed, splitDotPath(path))
    }
    return { values } satisfies ConfigDotMultiGetResponse
  })

export const configDotGet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const path = coerceString(d["path"]).trim()
    if (!path) throw new Error("missing path")
    return { ...base, path: normalizeDotPath(path) }
  })
  .handler(async ({ data }): Promise<ConfigDotGetResponse> => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: `config get ${data.path}`,
      args: ["config", "get", "--path", data.path, "--json"],
      note: "control-plane config read",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 30_000,
    })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId })
    if (terminal.status !== "succeeded") {
      throw new Error(terminal.errorMessage || lastErrorMessage(messages, "config read failed"))
    }
    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (!parsed) {
      throw new Error("config read command result missing JSON payload")
    }
    const path =
      typeof parsed.path === "string" && parsed.path.trim()
        ? parsed.path.trim()
        : data.path
    return {
      path,
      value: parsed.value,
    }
  })
