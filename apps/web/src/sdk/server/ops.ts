import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { enqueueRunnerJobForRun } from "~/sdk/runtime"
import {
  parseServerAuditExecuteInput,
  parseServerAuditStartInput,
  parseServerLogsExecuteInput,
  parseServerLogsStartInput,
  parseServerRestartExecuteInput,
  parseServerRestartStartInput,
  parseServerStatusExecuteInput,
  parseServerStatusStartInput,
  parseServerUpdateLogsExecuteInput,
  parseServerUpdateLogsStartInput,
  parseServerUpdateApplyExecuteInput,
  parseServerUpdateApplyStartInput,
  parseServerUpdateStatusExecuteInput,
  parseServerUpdateStatusStartInput,
} from "~/sdk/runtime"

function requireTypedConfirmation(params: {
  expected: string
  received: string
}): void {
  const expected = params.expected.trim()
  const received = params.received.trim()
  if (!expected) throw new Error("missing confirmation policy")
  if (expected !== received) {
    throw new Error(`confirmation mismatch (expected: "${expected}")`)
  }
}

export const serverUpdateApplyStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerUpdateApplyStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_update_apply",
      title: `Updater apply (${data.host})`,
      host: data.host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "server.update.apply",
      target: { host: data.host },
      data: { runId },
    })
    return { runId }
  })

export const serverUpdateApplyExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerUpdateApplyExecuteInput)
  .handler(async ({ data }) => {
    const expected = `apply updates ${data.host}`.trim()
    requireTypedConfirmation({ expected, received: data.confirm })

    const client = createConvexClient()
    const args = [
      "server",
      "update",
      "apply",
      "--host",
      data.host,
      ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
      "--ssh-tty=false",
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_update_apply",
      jobKind: "server_update_apply",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
        note: "runner queued from web execute endpoint",
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })

export const serverStatusStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerStatusStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_status",
      title: `Server status (${data.host})`,
      host: data.host,
    })
    return { runId }
  })

export const serverStatusExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerStatusExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const args = [
      "server",
      "status",
      "--host",
      data.host,
      ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
      "--ssh-tty=false",
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_status",
      jobKind: "server_status",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })

export const serverAuditStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerAuditStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_audit",
      title: `Server audit (${data.host})`,
      host: data.host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "server.audit",
      target: { host: data.host },
      data: { runId },
    })
    return { runId }
  })

export const serverAuditExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerAuditExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const args = [
      "server",
      "audit",
      "--host",
      data.host,
      ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
      "--json",
      "--ssh-tty=false",
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_audit",
      jobKind: "server_audit",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })

export const serverLogsStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerLogsStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const unit = data.unit.trim() || "openclaw-*.service"
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_logs",
      title: `Logs (${data.host} · ${unit})`,
      host: data.host,
    })
    return { runId }
  })

export const serverLogsExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerLogsExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const unit = data.unit.trim() || "openclaw-*.service"
    const lines = data.lines.trim() || "200"
    const args = [
      "server",
      "logs",
      "--host",
      data.host,
      "--unit",
      unit,
      "--lines",
      lines,
      ...(data.since.trim() ? ["--since", data.since.trim()] : []),
      ...(data.follow ? ["--follow"] : []),
      ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
      "--ssh-tty=false",
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_logs",
      jobKind: "server_logs",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })

export const serverUpdateStatusStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerUpdateStatusStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_update_status",
      title: `Updater status (${data.host})`,
      host: data.host,
    })
    return { runId }
  })

export const serverUpdateStatusExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerUpdateStatusExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const args = [
      "server",
      "update",
      "status",
      "--host",
      data.host,
      ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
      "--ssh-tty=false",
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_update_status",
      jobKind: "server_update_status",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })

export const serverUpdateLogsStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerUpdateLogsStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_update_logs",
      title: `Updater logs (${data.host})`,
      host: data.host,
    })
    return { runId }
  })

export const serverUpdateLogsExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerUpdateLogsExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const lines = data.lines.trim() || "200"
    const args = [
      "server",
      "update",
      "logs",
      "--host",
      data.host,
      "--lines",
      lines,
      ...(data.since.trim() ? ["--since", data.since.trim()] : []),
      ...(data.follow ? ["--follow"] : []),
      ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
      "--ssh-tty=false",
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_update_logs",
      jobKind: "server_update_logs",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })

export const serverRestartStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerRestartStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const unit = data.unit.trim() || "openclaw-*.service"
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_restart",
      title: `Restart (${data.host} · ${unit})`,
      host: data.host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "server.restart",
      target: { host: data.host, unit },
      data: { runId },
    })
    return { runId }
  })

export const serverRestartExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerRestartExecuteInput)
  .handler(async ({ data }) => {
    const unit = data.unit.trim() || "openclaw-*.service"
    const expected = `restart ${unit}`.trim()
    requireTypedConfirmation({ expected, received: data.confirm })

    const client = createConvexClient()
    const args = [
      "server",
      "restart",
      "--host",
      data.host,
      "--unit",
      unit,
      ...(data.targetHost.trim() ? ["--target-host", data.targetHost.trim()] : []),
      "--ssh-tty=false",
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_restart",
      jobKind: "server_restart",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })
