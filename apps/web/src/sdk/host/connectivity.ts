import { createServerFn } from "@tanstack/react-start"
import { validateTargetHost } from "@clawlets/core/lib/security/ssh-remote"
import {
  isValidIpv4,
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
  | { ok: true; ipv4: string; source: "infra_status" }
  | { ok: false; error: string; source: "infra_status" | "none" }

export type InfraStatusResult =
  | {
      ok: true
      host: string
      provider: string
      exists: boolean
      instanceId?: string
      ipv4?: string
      verified?: boolean
      detail?: string
    }
  | { ok: false; error: string }

export type TailscaleIpv4Result =
  | { ok: true; ipv4: string }
  | { ok: false; error: string; raw?: string }

type TailscaleIpv4ProbeConfig = {
  wait?: boolean
  waitTimeoutMs?: number
  waitPollMs?: number
}

type SshReachabilityProbeConfig = {
  wait?: boolean
  waitTimeoutMs?: number
  waitPollMs?: number
}

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
}): Promise<any> {
  const client = createConvexClient()
  const hosts = await client.query(api.controlPlane.hosts.listByProject, { projectId: params.projectId })
  const host = hosts.find((row) => row.hostName === params.host)
  if (!host) {
    throw new Error(`unknown host: ${params.host}`)
  }
  return host
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

function parseInfraStatusResult(raw: unknown): InfraStatusResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "infra status output missing" }
  }
  const row = raw as Record<string, unknown>
  const ok = row.ok === true
  if (!ok) {
    const error = typeof row.error === "string" ? row.error.trim() : ""
    return { ok: false, error: error || "infra status failed" }
  }
  const host = typeof row.host === "string" ? row.host.trim() : ""
  const provider = typeof row.provider === "string" ? row.provider.trim() : ""
  const exists = row.exists === true
  const instanceId = typeof row.instanceId === "string" ? row.instanceId.trim() : ""
  const ipv4 = typeof row.ipv4 === "string" ? row.ipv4.trim() : ""
  const detail = typeof row.detail === "string" ? row.detail.trim() : ""
  return {
    ok: true,
    host: host || "unknown",
    provider: provider || "unknown",
    exists,
    ...(instanceId ? { instanceId } : {}),
    ...(ipv4 ? { ipv4 } : {}),
    ...(row.verified === true ? { verified: true } : {}),
    ...(detail ? { detail } : {}),
  }
}

async function resolveInfraStatus(params: { projectId: Id<"projects">; host: string }): Promise<InfraStatusResult> {
  const queued = await enqueueCustomProbe({
    projectId: params.projectId,
    host: params.host,
    title: `Resolve infra status (${params.host})`,
    args: [
      "infra",
      "status",
      "--host",
      params.host,
      "--json",
    ],
  })
  const terminal = await waitForRunTerminal({
    projectId: params.projectId,
    runId: queued.runId,
    timeoutMs: 30_000,
    pollMs: 700,
  })
  const messages = terminal.status === "succeeded" ? [] : await listRunMessages(queued.runId)
  if (terminal.status !== "succeeded") {
    return { ok: false as const, error: terminal.errorMessage || lastErrorMessage(messages) }
  }
  const client = createConvexClient()
  const parsed = await takeRunnerCommandResultObject({
    client,
    projectId: params.projectId,
    jobId: queued.jobId,
    runId: queued.runId,
  })
  return parseInfraStatusResult(parsed)
}

export const getHostInfraStatus = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostRequiredInput)
  .handler(async ({ data }): Promise<InfraStatusResult> => {
    await assertKnownHost({ projectId: data.projectId, host: data.host })
    return await resolveInfraStatus({ projectId: data.projectId, host: data.host })
  })

export const getHostPublicIpv4 = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostRequiredInput)
  .handler(async ({ data }) => {
    await assertKnownHost({ projectId: data.projectId, host: data.host })
    const infra = await resolveInfraStatus({ projectId: data.projectId, host: data.host })
    if (!infra.ok) return { ok: false as const, error: infra.error, source: "infra_status" as const }
    if (!infra.exists) {
      const detail = typeof infra.detail === "string" ? infra.detail.trim() : ""
      return {
        ok: false as const,
        error: detail ? `host not provisioned: ${detail}` : "host not provisioned",
        source: "infra_status" as const,
      }
    }
    const ipv4 = typeof infra.ipv4 === "string" ? infra.ipv4.trim() : ""
    if (!ipv4 || !isValidIpv4(ipv4)) {
      return { ok: false as const, error: "infra status missing valid IPv4", source: "infra_status" as const }
    }
    return { ok: true as const, ipv4, source: "infra_status" as const }
  })

export const probeHostTailscaleIpv4 = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostTargetInput)
  .handler(async ({ data }): Promise<TailscaleIpv4Result> => {
    await assertKnownHost({ projectId: data.projectId, host: data.host })
    const targetHost = validateTargetHost(data.targetHost)
    const probeConfig = data as TailscaleIpv4ProbeConfig
    const wait = probeConfig.wait === true
    const waitTimeoutMs = probeConfig.waitTimeoutMs ?? 600_000
    const waitPollMs = probeConfig.waitPollMs ?? 5_000

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
        ...(wait ? [
          "--wait",
          `--wait-timeout=${String(waitTimeoutMs)}`,
          `--wait-poll-ms=${String(waitPollMs)}`,
        ] : []),
        "--json",
        "--ssh-tty=false",
      ],
    })
    const terminal = await waitForRunTerminal({
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: wait ? waitTimeoutMs + 60_000 : 30_000,
      pollMs: wait ? 2_000 : 700,
    })
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

    const probeConfig = data as SshReachabilityProbeConfig
    const wait = probeConfig.wait === true
    const waitTimeoutMs = probeConfig.waitTimeoutMs ?? 300_000
    const waitPollMs = probeConfig.waitPollMs ?? 5_000

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
        ...(wait ? [
          "--wait",
          `--wait-timeout=${String(waitTimeoutMs)}`,
          `--wait-poll-ms=${String(waitPollMs)}`,
        ] : []),
        "--json",
        "--ssh-tty=false",
      ],
    })
    const terminal = await waitForRunTerminal({
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: wait ? waitTimeoutMs + 60_000 : 30_000,
      pollMs: wait ? 2_000 : 700,
    })
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
