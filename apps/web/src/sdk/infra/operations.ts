import { createServerFn } from "@tanstack/react-start"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { coerceString, enqueueRunnerJobForRun, parseProjectIdInput } from "~/sdk/runtime"

export const runDoctor = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      host: coerceString(d["host"]),
      scope: (typeof d["scope"] === "string" ? d["scope"] : "all") as
        | "repo"
        | "bootstrap"
        | "updates"
        | "cattle"
        | "all",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()

    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "doctor",
      title: `Doctor (${data.scope})`,
      host: data.host,
    })
    const args = ["doctor", "--scope", data.scope, ...(data.host.trim() ? ["--host", data.host.trim()] : [])]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId,
      expectedKind: "doctor",
      jobKind: "doctor",
      host: data.host.trim() || undefined,
      payloadMeta: {
        hostName: data.host.trim() || undefined,
        args,
      },
    })
    return { runId: queued.runId, checks: [] as any[], ok: true as const, queued: true as const, jobId: queued.jobId }
  })

export const bootstrapStart = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      host: coerceString(d["host"]),
      mode: (coerceString(d["mode"]).trim() || "nixos-anywhere") as "nixos-anywhere" | "image",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "bootstrap",
      title: `Bootstrap (${data.host})`,
      host: data.host,
    })
    await client.mutation(api.security.auditLogs.append, {
      projectId: data.projectId,
      action: "bootstrap",
      target: { host: data.host, mode: data.mode },
      data: { runId },
    })
    return { runId }
  })

export const bootstrapExecute = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      runId: d["runId"] as Id<"runs">,
      host: coerceString(d["host"]),
      mode: (coerceString(d["mode"]).trim() || "nixos-anywhere") as "nixos-anywhere" | "image",
      force: Boolean(d["force"]),
      dryRun: Boolean(d["dryRun"]),
      lockdownAfter: Boolean(d["lockdownAfter"]),
      rev: typeof d["rev"] === "string" ? d["rev"] : "",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const args = [
      "bootstrap",
      "--host",
      data.host,
      `--mode=${data.mode}`,
      ...(data.rev.trim() ? ["--rev", data.rev.trim()] : []),
      ...(data.lockdownAfter ? ["--lockdown-after"] : []),
      ...(data.force ? ["--force"] : []),
      ...(data.dryRun ? ["--dry-run"] : []),
    ]
    const queued = await enqueueRunnerJobForRun({
      client,
      projectId: data.projectId,
      runId: data.runId,
      expectedKind: "bootstrap",
      jobKind: "bootstrap",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        args,
      },
    })
    return { ok: true as const, queued: true as const, jobId: queued.jobId, runId: queued.runId }
  })
