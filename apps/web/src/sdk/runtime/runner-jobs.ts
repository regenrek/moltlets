import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { ConvexClient } from "~/server/convex"

export type TerminalRunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function enqueueRunnerCommand(params: {
  client: ConvexClient
  projectId: Id<"projects">
  runKind: string
  title: string
  host?: string
  args: string[]
  note?: string
}): Promise<{ runId: Id<"runs">; jobId: Id<"jobs"> }> {
  const host = String(params.host || "").trim() || undefined
  const queued = await params.client.mutation(api.controlPlane.jobs.enqueue, {
    projectId: params.projectId,
    kind: params.runKind as any,
    title: params.title,
    host,
    payloadMeta: {
      hostName: host,
      args: params.args,
      note: params.note,
    },
  })
  return queued
}

export async function waitForRunTerminal(params: {
  client: ConvexClient
  projectId: Id<"projects">
  runId: Id<"runs">
  timeoutMs?: number
  pollMs?: number
}): Promise<{ status: TerminalRunStatus; errorMessage?: string }> {
  const timeoutMs = params.timeoutMs ?? 25_000
  const pollMs = params.pollMs ?? 700
  const startedAt = Date.now()
  let lastStatus: TerminalRunStatus = "running"

  while (Date.now() - startedAt < timeoutMs) {
    const runGet = await params.client.query(api.controlPlane.runs.get, { runId: params.runId })
    if (!runGet.run || runGet.run.projectId !== params.projectId) {
      throw new Error("run not found")
    }
    const status = runGet.run.status as TerminalRunStatus
    lastStatus = status
    if (status === "succeeded" || status === "failed" || status === "canceled") {
      return { status, errorMessage: runGet.run.errorMessage || undefined }
    }
    await sleep(pollMs)
  }

  return { status: lastStatus, errorMessage: "runner timeout waiting for completion" }
}

export async function listRunMessages(params: {
  client: ConvexClient
  runId: Id<"runs">
  limit?: number
}): Promise<string[]> {
  const page = await params.client.query(api.controlPlane.runEvents.pageByRun, {
    runId: params.runId,
    paginationOpts: { numItems: Math.max(1, Math.min(500, params.limit ?? 200)), cursor: null },
  })
  return (page.page || []).map((row: any) => String(row.message || "")).filter(Boolean).toReversed()
}

export function parseLastJsonMessage<T extends Record<string, unknown>>(messages: string[]): T | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]?.trim() || ""
    if (!message || !message.startsWith("{") || !message.endsWith("}")) continue
    try {
      const parsed = JSON.parse(message) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as T
      }
    } catch {
      continue
    }
  }
  return null
}

export function lastErrorMessage(messages: string[], fallback = "runner command failed"): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = (messages[i] || "").trim()
    if (!message) continue
    if (/error|failed|timeout|missing|invalid/i.test(message)) return message
  }
  return fallback
}
