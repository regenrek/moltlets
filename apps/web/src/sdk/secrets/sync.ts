import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  enqueueRunnerCommand,
  enqueueRunnerJobForRun,
  lastErrorMessage,
  listRunMessages,
  parseProjectHostInput,
  parseProjectRunHostInput,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"

export const secretsSyncStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const host = data.host.trim()
    if (!host) throw new Error("missing host")

    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "secrets_sync",
      title: `Secrets sync (${host})`,
      host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.sync",
      target: { host },
      data: { runId },
    })
    return { runId }
  })

export const secretsSyncPreview = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: `Secrets sync preview (${host})`,
      host,
      args: ["secrets", "sync", "--host", host, "--preview-json"],
      note: "control-plane sync preview",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 45_000,
    })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId, limit: 300 })
    if (terminal.status !== "succeeded") {
      return { ok: false as const, message: terminal.errorMessage || lastErrorMessage(messages, "preview failed") }
    }
    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (!parsed) {
      return { ok: false as const, message: "preview command result missing JSON payload" }
    }
    const files = Array.isArray(parsed.files)
      ? parsed.files.map((entry) => String(entry || "").trim()).filter(Boolean)
      : []
    return {
      ok: true as const,
      localDir: typeof parsed.localDir === "string" ? parsed.localDir : "",
      remoteDir: typeof parsed.remoteDir === "string" ? parsed.remoteDir : "",
      digest: typeof parsed.digest === "string" ? parsed.digest : "",
      files,
    }
  })

export const secretsSyncExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const args = ["secrets", "sync", "--host", host, "--ssh-tty=false"]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "secrets_sync",
      jobKind: "secrets_sync",
      host,
      payloadMeta: {
        hostName: host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })
