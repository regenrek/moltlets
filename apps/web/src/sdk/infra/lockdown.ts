import { createServerFn } from "@tanstack/react-start"
import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import { enqueueRunnerJobForRun, parseProjectHostRequiredInput, parseProjectRunHostInput } from "~/sdk/runtime"

export const lockdownStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostRequiredInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "lockdown",
      title: `Lockdown (${data.host})`,
      host: data.host,
    })
    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "lockdown",
      target: { host: data.host },
      data: { runId },
    })
    return { runId }
  })

export const lockdownExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "lockdown",
      jobKind: "lockdown",
      host,
      payloadMeta: {
        hostName: host,
        args: ["lockdown", "--host", host],
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })
