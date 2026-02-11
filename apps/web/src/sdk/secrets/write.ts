import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { parseWriteHostSecretsFinalizeInput, parseWriteHostSecretsInput } from "~/sdk/runtime"

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
    const reserved = await client.mutation(api.controlPlane.jobs.reserveSealedInput, {
      projectId: data.projectId,
      kind: "secrets_write",
      title: `Secrets write (${host})`,
      host,
      targetRunnerId: data.targetRunnerId,
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
        note: "secrets sealed input attached at finalize",
      },
    })

    return {
      ok: true as const,
      reserved: true as const,
      runId: reserved.runId,
      jobId: reserved.jobId,
      kind: reserved.kind,
      sealedInputAlg: reserved.sealedInputAlg,
      sealedInputKeyId: reserved.sealedInputKeyId,
      sealedInputPubSpkiB64: reserved.sealedInputPubSpkiB64,
      targetRunnerId: data.targetRunnerId,
      secretNames,
      host,
    }
  })

export const writeHostSecretsFinalize = createServerFn({ method: "POST" })
  .inputValidator(parseWriteHostSecretsFinalizeInput)
  .handler(async ({ data }) => {
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const secretNames = data.secretNames
    if (secretNames.length === 0) throw new Error("no secrets provided")
    const client = createConvexClient()
    const project = await client.query(api.controlPlane.projects.get, { projectId: data.projectId })
    if (!project || project.role !== "admin") throw new Error("admin required")
    const queued = await client.mutation(api.controlPlane.jobs.finalizeSealedEnqueue, {
      projectId: data.projectId,
      jobId: data.jobId,
      kind: data.kind,
      sealedInputB64: data.sealedInputB64,
      sealedInputAlg: data.sealedInputAlg,
      sealedInputKeyId: data.sealedInputKeyId,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.write",
      target: { host },
      data: {
        runId: queued.runId,
        jobId: queued.jobId,
        targetRunnerId: data.targetRunnerId,
        secrets: secretNames,
      },
    })
    return {
      ok: true as const,
      queued: true as const,
      runId: queued.runId,
      jobId: queued.jobId,
      updated: secretNames,
      targetRunnerId: data.targetRunnerId,
    }
  })
