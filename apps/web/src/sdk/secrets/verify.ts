import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import { enqueueRunnerJobForRun, parseProjectHostScopeInput, parseProjectRunHostScopeInput } from "~/sdk/runtime"
import { getSecretsVerifyRunKind } from "./run-kind"

export const secretsVerifyStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostScopeInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const runKind = getSecretsVerifyRunKind(data.scope)

    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: runKind,
      title: `Secrets verify (${host}, scope=${data.scope})`,
      host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.verify",
      target: { host },
      data: { runId, scope: data.scope },
    })
    return { runId }
  })

export const secretsVerifyExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostScopeInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const expectedKind = getSecretsVerifyRunKind(data.scope)
    const host = data.host.trim()
    if (!host) throw new Error("missing host")

    const args = ["secrets", "verify", "--host", host, "--scope", data.scope, "--json"]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind,
      jobKind: expectedKind,
      host,
      payloadMeta: {
        hostName: host,
        scope: data.scope === "all" ? undefined : data.scope,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })
