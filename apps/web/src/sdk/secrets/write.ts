import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { parseWriteHostSecretsInput } from "~/sdk/runtime"

export const writeHostSecrets = createServerFn({ method: "POST" })
  .inputValidator(parseWriteHostSecretsInput)
  .handler(async ({ data }) => {
    const host = data.host.trim()
    if (!host) throw new Error("missing host")

    const secretNames = data.secretNames
    if (secretNames.length === 0) throw new Error("no secrets provided")

    const client = createConvexClient()
    const project = await client.query(api.controlPlane.projects.get, { projectId: data.projectId })
    if (!project || project.role !== "admin") throw new Error("admin required")
    const queued = await client.mutation(api.controlPlane.jobs.enqueue, {
      projectId: data.projectId,
      kind: "secrets_write",
      title: `Secrets write (${host})`,
      host,
      payloadMeta: {
        hostName: host,
        scope: "all",
        secretNames,
        args: [
          "secrets",
          "init",
          "--host",
          host,
          "--scope",
          "all",
          "--from-json",
          "__RUNNER_SECRETS_JSON__",
          "--yes",
        ],
        note: "secrets supplied locally to runner (localhost submit or runner prompt)",
      },
    })

    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.write",
      target: { host },
      data: { runId: queued.runId, secrets: secretNames },
    })

    return {
      ok: true as const,
      queued: true as const,
      runId: queued.runId,
      jobId: queued.jobId,
      updated: secretNames,
      localSubmitRequired: true as const,
    }
  })
