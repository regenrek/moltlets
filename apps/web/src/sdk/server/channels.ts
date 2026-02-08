import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { enqueueRunnerJobForRun, parseServerChannelsExecuteInput, parseServerChannelsStartInput } from "~/sdk/runtime"

export const serverChannelsStart = createServerFn({ method: "POST" })
  .inputValidator(parseServerChannelsStartInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const gatewayId = data.gatewayId

    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "server_channels",
      title: `Channels ${data.op} (${gatewayId}@${host})`,
      host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "server.channels",
      target: { host, gatewayId, op: data.op },
      data: { runId },
    })
    return { runId }
  })

export const serverChannelsExecute = createServerFn({ method: "POST" })
  .inputValidator(parseServerChannelsExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const gatewayId = data.gatewayId

    const args = ["server", "channels", data.op, "--host", host, "--gateway", gatewayId]

    if (data.op === "status") {
      if (data.probe) args.push("--probe")
      args.push(`--timeout=${data.timeoutMs}`)
      if (data.json) args.push("--json")
    }

    if (data.op === "capabilities") {
      if (data.channel) args.push(`--channel=${data.channel}`)
      if (data.account) args.push(`--account=${data.account}`)
      if (data.target) args.push(`--target=${data.target}`)
      args.push(`--timeout=${data.timeoutMs}`)
      if (data.json) args.push("--json")
    }

    if (data.op === "login") {
      if (data.channel) args.push(`--channel=${data.channel}`)
      if (data.account) args.push(`--account=${data.account}`)
      if (data.verbose) args.push("--verbose")
    }

    if (data.op === "logout") {
      if (data.channel) args.push(`--channel=${data.channel}`)
      if (data.account) args.push(`--account=${data.account}`)
    }

    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "server_channels",
      jobKind: "server_channels",
      host,
      payloadMeta: {
        hostName: host,
        gatewayId,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })
