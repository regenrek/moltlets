import { createServerFn } from "@tanstack/react-start"
import { validateTargetHost } from "@clawlets/core/lib/security/ssh-remote"
import {
  parseBootstrapIpv4FromLogs,
} from "@clawlets/core/lib/host/host-connectivity"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import {
  enqueueRunnerJobForRun,
  parseProjectHostRequiredInput,
  parseProjectHostTargetInput,
  takeRunnerCommandResultObject,
} from "~/sdk/runtime"

export type PublicIpv4Result =
  | { ok: true; ipv4: string; source: "bootstrap_logs" }
  | { ok: false; error: string; source: "bootstrap_logs" | "none" }

export type TailscaleIpv4Result =
  | { ok: true; ipv4: string }
  | { ok: false; error: string; raw?: string }

export type SshReachabilityResult =
  | { ok: true; hostname?: string }
  | { ok: false; error: string }

type MinimalRunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function assertKnownHost(params: {
  projectId: Id<"projects">
  host: string
}): Promise<void> {
  const client = createConvexClient()
  const hosts = await client.query(api.controlPlane.hosts.listByProject, { projectId: params.projectId })
  if (!hosts.some((row) => row.hostName === params.host)) {
    throw new Error(`unknown host: ${params.host}`)
  }
}

async function enqueueCustomProbe(params: {
  projectId: Id<"projects">
  host: string
  title: string
  args: string[]
}): Promise<{ runId: Id<"runs">; jobId: Id<"jobs"> }> {
  const client = createConvexClient()
  const { runId } = await client.mutation(api.controlPlane.runs.create, {
    projectId: params.projectId,
    kind: "custom",
    title: params.title,
    host: params.host,
  })
  const queued = await enqueueRunnerJobForRun({
    client,
    projectId: params.projectId,
    runId,
    expectedKind: "custom",
    jobKind: "custom",
    host: params.host,
    payloadMeta: {
      hostName: params.host,
      args: params.args,
      note: "web connectivity probe",
    },
  })
  return { runId, jobId: queued.jobId }
}

async function waitForRunTerminal(params: {
  projectId: Id<"projects">
  runId: Id<"runs">
  timeoutMs?: number
  pollMs?: number
}): Promise<{ status: MinimalRunStatus; errorMessage?: string }> {
  const client = createConvexClient()
  const timeoutMs = params.timeoutMs ?? 20_000
  const pollMs = params.pollMs ?? 700
  const startedAt = Date.now()
  let lastStatus: MinimalRunStatus = "running"

  while (Date.now() - startedAt < timeoutMs) {
    const runGet = await client.query(api.controlPlane.runs.get, { runId: params.runId })
    if (!runGet.run || runGet.run.projectId !== params.projectId) {
      throw new Error("run not found")
    }
    const status = runGet.run.status as MinimalRunStatus
    lastStatus = status
    if (status === "succeeded" || status === "failed" || status === "canceled") {
      return { status, errorMessage: runGet.run.errorMessage || undefined }
    }
    await sleep(pollMs)
  }

  return { status: lastStatus, errorMessage: "runner timeout waiting for probe completion" }
}

async function listRunMessages(runId: Id<"runs">): Promise<string[]> {
  const client = createConvexClient()
  const page = await client.query(api.controlPlane.runEvents.pageByRun, {
    runId,
    paginationOpts: { numItems: 100, cursor: null },
  })
  return (page.page || []).map((row: any) => String(row.message || "")).filter(Boolean).toReversed()
}

function lastErrorMessage(messages: string[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = (messages[i] || "").trim()
    if (!message) continue
    if (/error|failed|timeout/i.test(message)) return message
  }
  return "probe failed"
}

async function resolveBootstrapIpv4(params: { projectId: Id<"projects">; host: string }): Promise<PublicIpv4Result> {
  const client = createConvexClient()
  const page = await client.query(api.controlPlane.runs.listByProjectPage, {
    projectId: params.projectId,
    paginationOpts: { numItems: 50, cursor: null },
  })
  const runs = page.page || []
  const match = runs.find((run: any) => run.kind === "bootstrap" && String(run.title || "").includes(params.host))
  if (!match) return { ok: false, error: "bootstrap run not found", source: "bootstrap_logs" }

  const eventsPage = await client.query(api.controlPlane.runEvents.pageByRun, {
    runId: match._id,
    paginationOpts: { numItems: 100, cursor: null },
  })
  const messages = (eventsPage.page || []).map((ev: any) => String(ev.message || ""))
  const ipv4 = parseBootstrapIpv4FromLogs(messages)
  if (!ipv4) return { ok: false, error: "bootstrap logs missing IPv4", source: "bootstrap_logs" }
  return { ok: true, ipv4, source: "bootstrap_logs" }
}

export const getHostPublicIpv4 = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostRequiredInput)
  .handler(async ({ data }) => {
    await assertKnownHost({ projectId: data.projectId, host: data.host })
    const fallback = await resolveBootstrapIpv4({ projectId: data.projectId, host: data.host })
    if (fallback.ok) return fallback
    return { ok: false as const, error: fallback.error, source: "none" }
  })

export const probeHostTailscaleIpv4 = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostTargetInput)
  .handler(async ({ data }): Promise<TailscaleIpv4Result> => {
    await assertKnownHost({ projectId: data.projectId, host: data.host })
    const targetHost = validateTargetHost(data.targetHost)

    const queued = await enqueueCustomProbe({
      projectId: data.projectId,
      host: data.host,
      title: `Probe tailscale IPv4 (${data.host})`,
      args: [
        "server",
        "tailscale-ipv4",
        "--host",
        data.host,
        "--target-host",
        targetHost,
        "--json",
        "--ssh-tty=false",
      ],
    })
    const terminal = await waitForRunTerminal({ projectId: data.projectId, runId: queued.runId })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages(queued.runId)
    if (terminal.status !== "succeeded") {
      return { ok: false as const, error: terminal.errorMessage || lastErrorMessage(messages) }
    }
    const client = createConvexClient()
    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (parsed?.ok && typeof parsed.ipv4 === "string" && parsed.ipv4.trim()) {
      return { ok: true as const, ipv4: parsed.ipv4.trim() }
    }
    return { ok: false as const, error: typeof parsed?.error === "string" ? parsed.error : "tailscale probe output missing ipv4" }
  })

export const probeSshReachability = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostTargetInput)
  .handler(async ({ data }): Promise<SshReachabilityResult> => {
    await assertKnownHost({ projectId: data.projectId, host: data.host })
    const targetHost = validateTargetHost(data.targetHost)

    const queued = await enqueueCustomProbe({
      projectId: data.projectId,
      host: data.host,
      title: `Probe SSH reachability (${data.host})`,
      args: [
        "server",
        "ssh-check",
        "--host",
        data.host,
        "--target-host",
        targetHost,
        "--json",
        "--ssh-tty=false",
      ],
    })
    const terminal = await waitForRunTerminal({ projectId: data.projectId, runId: queued.runId })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages(queued.runId)
    if (terminal.status !== "succeeded") {
      return { ok: false as const, error: terminal.errorMessage || lastErrorMessage(messages) }
    }
    const client = createConvexClient()
    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (parsed?.ok) {
      return { ok: true as const, hostname: typeof parsed.hostname === "string" ? parsed.hostname : undefined }
    }
    return { ok: false as const, error: typeof parsed?.error === "string" ? parsed.error : "ssh probe output missing" }
  })
