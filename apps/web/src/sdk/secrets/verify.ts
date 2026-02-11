import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  enqueueRunnerJobForRun,
  lastErrorMessage,
  listRunMessages,
  parseProjectHostScopeInput,
  parseProjectRunHostScopeInput,
  waitForRunTerminal,
  type TerminalRunStatus,
} from "~/sdk/runtime"
import { getSecretsVerifyRunKind } from "./run-kind"

const SECRETS_VERIFY_WAIT_TIMEOUT_MS = 45_000

type SecretsVerifyInput = ReturnType<typeof parseProjectHostScopeInput>
type SecretsVerifyWaitStatus = "succeeded" | "failed" | "canceled" | "timed_out"

export function mapSecretsVerifyTerminalStatus(status: TerminalRunStatus): SecretsVerifyWaitStatus {
  if (status === "succeeded" || status === "failed" || status === "canceled") return status
  return "timed_out"
}

async function createSecretsVerifyRun(params: {
  data: SecretsVerifyInput
}) {
  const client = createConvexClient()
  await requireAdminProjectAccess(client, params.data.projectId)
  const host = params.data.host.trim()
  if (!host) throw new Error("missing host")
  const runKind = getSecretsVerifyRunKind(params.data.scope)
  const { runId } = await client.mutation(api.controlPlane.runs.create, {
    projectId: params.data.projectId,
    kind: runKind,
    title: `Secrets verify (${host}, scope=${params.data.scope})`,
    host,
  })
  await client.mutation(api.security.auditLogs.append, {
    projectId: params.data.projectId,
    action: "secrets.verify",
    target: { host },
    data: { runId, scope: params.data.scope },
  })
  return {
    client,
    host,
    runId,
    expectedKind: runKind,
  }
}

async function enqueueSecretsVerifyJob(params: {
  client: ReturnType<typeof createConvexClient>
  projectId: SecretsVerifyInput["projectId"]
  runId: ReturnType<typeof parseProjectRunHostScopeInput>["runId"]
  expectedKind: string
  host: string
  scope: SecretsVerifyInput["scope"]
}) {
  const args = ["secrets", "verify", "--host", params.host, "--scope", params.scope, "--json"]
  return await enqueueRunnerJobForRun({
    client: params.client,
    projectId: params.projectId,
    runId: params.runId,
    expectedKind: params.expectedKind,
    jobKind: params.expectedKind,
    host: params.host,
    payloadMeta: {
      hostName: params.host,
      scope: params.scope === "all" ? undefined : params.scope,
      args,
    },
  })
}

export const secretsVerifyStart = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostScopeInput)
  .handler(async ({ data }) => {
    const run = await createSecretsVerifyRun({ data })
    return { runId: run.runId }
  })

export const secretsVerifyExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectRunHostScopeInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const host = data.host.trim()
    if (!host) throw new Error("missing host")
    const queued = await enqueueSecretsVerifyJob({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: getSecretsVerifyRunKind(data.scope),
      host,
      scope: data.scope,
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })

export const secretsVerifyAndWait = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostScopeInput)
  .handler(async ({ data }) => {
    const run = await createSecretsVerifyRun({ data })
    await enqueueSecretsVerifyJob({
      client: run.client,
      projectId: data.projectId,
      runId: run.runId,
      expectedKind: run.expectedKind,
      host: run.host,
      scope: data.scope,
    })

    const terminal = await waitForRunTerminal({
      client: run.client,
      projectId: data.projectId,
      runId: run.runId,
      timeoutMs: SECRETS_VERIFY_WAIT_TIMEOUT_MS,
    })
    const status = mapSecretsVerifyTerminalStatus(terminal.status)
    if (status === "succeeded") return { runId: run.runId, status }

    const messages = await listRunMessages({
      client: run.client,
      runId: run.runId,
      limit: 300,
    })
    return {
      runId: run.runId,
      status,
      errorMessage: terminal.errorMessage || lastErrorMessage(messages, "secrets verify failed"),
    }
  })
