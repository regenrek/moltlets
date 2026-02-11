import { createServerFn } from "@tanstack/react-start"
import { buildFleetSecretsPlan } from "@clawlets/core/lib/secrets/plan"
import {
  buildSecretsInitTemplate,
} from "@clawlets/core/lib/secrets/secrets-init"
import { buildSecretsInitTemplateSets } from "@clawlets/core/lib/secrets/secrets-init-template"
import { ClawletsConfigSchema } from "@clawlets/core/lib/config/clawlets-config"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseProjectIdInput,
  parseProjectHostScopeInput,
  parseSecretsInitExecuteInput,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"
import type { Id } from "../../../convex/_generated/dataModel"
import { resolveHostFromConfig } from "./helpers"

export const getSecretsTemplate = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostScopeInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: "config show",
      args: ["config", "show", "--pretty=false"],
      note: "secrets template config read",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 30_000,
    })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId, limit: 300 })
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
      throw new Error("config show command result missing JSON payload")
    }
    const config = ClawletsConfigSchema.parse(parsed)
    const host = resolveHostFromConfig(config, data.host, { requireKnownHost: true })

    const hostCfg = config.hosts[host]

    const secretsPlan = buildFleetSecretsPlan({ config, hostName: host, scope: data.scope })
    const sets = buildSecretsInitTemplateSets({ secretsPlan, hostCfg, scope: data.scope })
    const template = buildSecretsInitTemplate({
      requiresTailscaleAuthKey: sets.requiresTailscaleAuthKey,
      requiresAdminPassword: sets.requiresAdminPassword,
      secrets: sets.templateSecrets,
    })

    return {
      host,
      gateways: secretsPlan.gateways,
      secretsPlan,
      missingSecretConfig: secretsPlan.missing,
      requiredSecretNames: sets.requiredSecretNames,
      templateJson: `${JSON.stringify(template, null, 2)}\n`,
    }
  })

export const secretsInitStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostScopeInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const host = data.host.trim()
    if (!host) throw new Error("missing host")

    const hosts = await client.query(api.controlPlane.hosts.listByProject, { projectId: data.projectId })
    if (!hosts.some((row) => row.hostName === host)) {
      throw new Error(`unknown host: ${host}`)
    }

    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "secrets_init",
      title: `Secrets init (${host}, scope=${data.scope})`,
      host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.init",
      target: { host },
      data: { runId, scope: data.scope },
    })
    await client.mutation(api.controlPlane.runEvents.appendBatch, {
      runId,
      events: [{ ts: Date.now(), level: "info", message: "Starting secrets init…" }],
    })
    return { runId }
  })

export const secretsInitExecute = createServerFn({ method: "POST" })
  .inputValidator(parseSecretsInitExecuteInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const secretNames = data.secretNames
    const args = [
      "secrets",
      "init",
      "--host",
      host,
      "--scope",
      data.scope,
      "--from-json",
      "__RUNNER_SECRETS_JSON__",
      "--yes",
      ...(data.allowPlaceholders ? ["--allow-placeholders"] : []),
    ]
    const reserved = await client.mutation(api.controlPlane.jobs.reserveSealedInput, {
      projectId: data.projectId,
      runId: data.runId,
      kind: "secrets_init",
      host,
      targetRunnerId: data.targetRunnerId,
      payloadMeta: {
        hostName: host,
        scope: data.scope === "all" ? undefined : data.scope,
        secretNames,
        args,
        note: "secrets sealed input attached at finalize",
      },
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "secrets.init",
      target: { host },
      data: {
        runId: reserved.runId,
        jobId: reserved.jobId,
        targetRunnerId: data.targetRunnerId,
        scope: data.scope,
      },
    })
    return {
      ok: true as const,
      reserved: true as const,
      jobId: reserved.jobId,
      runId: reserved.runId,
      kind: reserved.kind,
      sealedInputAlg: reserved.sealedInputAlg,
      sealedInputKeyId: reserved.sealedInputKeyId,
      sealedInputPubSpkiB64: reserved.sealedInputPubSpkiB64,
      targetRunnerId: data.targetRunnerId,
    }
  })

export const secretsInitFinalize = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const jobId = typeof d["jobId"] === "string" ? d["jobId"].trim() : ""
    const kind = typeof d["kind"] === "string" ? d["kind"].trim() : ""
    const sealedInputB64 = typeof d["sealedInputB64"] === "string" ? d["sealedInputB64"].trim() : ""
    const sealedInputAlg = typeof d["sealedInputAlg"] === "string" ? d["sealedInputAlg"].trim() : ""
    const sealedInputKeyId = typeof d["sealedInputKeyId"] === "string" ? d["sealedInputKeyId"].trim() : ""
    if (!jobId || !kind || !sealedInputB64 || !sealedInputAlg || !sealedInputKeyId) {
      throw new Error("invalid sealed finalize payload")
    }
    return {
      ...base,
      jobId: jobId as Id<"jobs">,
      kind,
      sealedInputB64,
      sealedInputAlg,
      sealedInputKeyId,
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    return await client.mutation(api.controlPlane.jobs.finalizeSealedEnqueue, {
      projectId: data.projectId,
      jobId: data.jobId,
      kind: data.kind,
      sealedInputB64: data.sealedInputB64,
      sealedInputAlg: data.sealedInputAlg,
      sealedInputKeyId: data.sealedInputKeyId,
    })
  })
