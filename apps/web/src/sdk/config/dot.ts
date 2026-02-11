import { createServerFn } from "@tanstack/react-start"
import { splitDotPath } from "@clawlets/core/lib/storage/dot-path"
import { createConvexClient } from "~/server/convex"
import { GATEWAY_OPENCLAW_POLICY_MESSAGE, isGatewayOpenclawPath } from "./helpers"
import type { ValidationIssue } from "~/sdk/runtime"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  coerceString,
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseProjectIdInput,
  waitForRunTerminal,
} from "~/sdk/runtime"
export {
  configDotGet,
  configDotMultiGet,
  type ConfigDotGetResponse,
  type ConfigDotMultiGetResponse,
} from "./dot-get"

type ConfigDotOp = {
  path: string
  value?: string
  valueJson?: string
  del: boolean
}

function toFailure(message: string): { ok: false; issues: ValidationIssue[] } {
  return {
    ok: false as const,
    issues: [{ code: "error", path: [], message }],
  }
}

export const configDotSet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const path = coerceString(d["path"]).trim()
    if (!path) throw new Error("missing path")
    const value = d["value"] === undefined ? undefined : coerceString(d["value"])
    const valueJson = d["valueJson"] === undefined ? undefined : coerceString(d["valueJson"])
    const del = Boolean(d["del"])
    if (value !== undefined && valueJson !== undefined) {
      throw new Error("ambiguous value (provide value or valueJson, not both)")
    }
    if (del && (value !== undefined || valueJson !== undefined)) {
      throw new Error("invalid request (del=true cannot include value)")
    }
    if (!del && value === undefined && valueJson === undefined) {
      throw new Error("missing value (or set del=true)")
    }
    return {
      ...base,
      path,
      value,
      valueJson,
      del,
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const parts = splitDotPath(data.path)

    if (isGatewayOpenclawPath(parts)) {
      return {
        ok: false as const,
        issues: [
          {
            code: "policy",
            path: parts,
            message: GATEWAY_OPENCLAW_POLICY_MESSAGE,
          },
        ],
      }
    }

    const args = ["config", "set", "--path", parts.join(".")]
    if (data.del) {
      args.push("--delete")
    } else if (data.valueJson !== undefined) {
      try {
        JSON.parse(data.valueJson)
      } catch {
        throw new Error("invalid JSON value")
      }
      args.push("--value-json", data.valueJson)
    } else if (data.value !== undefined) {
      args.push("--value", data.value)
    } else {
      return toFailure("missing value (or set del=true)")
    }

    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "config_write",
      title: `config set ${parts.join(".")}`,
      args,
      note: "control-plane config write",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 45_000,
    })
    if (terminal.status !== "succeeded") {
      const messages = await listRunMessages({ client, runId: queued.runId })
      return toFailure(terminal.errorMessage || lastErrorMessage(messages, "config update failed"))
    }
    return { ok: true as const, runId: queued.runId }
  })

export const configDotBatch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const opsRaw = d["ops"]
    if (!Array.isArray(opsRaw)) throw new Error("missing ops")
    if (opsRaw.length === 0) throw new Error("missing ops")
    if (opsRaw.length > 100) throw new Error("too many ops (max 100)")
    const ops = opsRaw.map((op, i) => {
      if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error(`invalid op at index ${i}`)
      const o = op as Record<string, unknown>
      const path = coerceString(o["path"])
      const del = Boolean(o["del"])
      const value = o["value"] === undefined ? undefined : coerceString(o["value"])
      const valueJson = o["valueJson"] === undefined ? undefined : coerceString(o["valueJson"])
      if (value !== undefined && valueJson !== undefined) {
        throw new Error(`ambiguous op at index ${i} (provide value or valueJson, not both)`)
      }
      if (del && (value !== undefined || valueJson !== undefined)) {
        throw new Error(`invalid op at index ${i} (del=true cannot include value)`)
      }
      if (!path.trim()) throw new Error(`missing path at index ${i}`)
      if (!del && value === undefined && valueJson === undefined) throw new Error(`missing value for op at index ${i}`)
      return { path, value, valueJson, del }
    })

    return { ...base, ops }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const normalizedOps: ConfigDotOp[] = data.ops.map((op) => ({
      path: splitDotPath(op.path).join("."),
      value: op.value,
      valueJson: op.valueJson,
      del: op.del,
    }))
    for (const op of normalizedOps) {
      const parts = splitDotPath(op.path)
      if (!isGatewayOpenclawPath(parts)) continue
      return {
        ok: false as const,
        issues: [
          {
            code: "policy",
            path: parts,
            message: GATEWAY_OPENCLAW_POLICY_MESSAGE,
          },
        ],
      }
    }
    for (const op of normalizedOps) {
      if (op.valueJson === undefined) continue
      try {
        JSON.parse(op.valueJson)
      } catch {
        throw new Error(`invalid JSON value at ${op.path}`)
      }
    }
    const title =
      normalizedOps.length === 1
        ? `config set ${normalizedOps[0]?.path || "unknown"}`
        : `config set ${normalizedOps[0]?.path || "unknown"} (+${normalizedOps.length - 1} more)`
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "config_write",
      title,
      args: ["config", "batch-set", "--ops-json", JSON.stringify(normalizedOps)],
      note: "control-plane config batch write",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 60_000,
    })
    if (terminal.status !== "succeeded") {
      const messages = await listRunMessages({ client, runId: queued.runId })
      return toFailure(terminal.errorMessage || lastErrorMessage(messages, "config update failed"))
    }
    return { ok: true as const, runId: queued.runId }
  })
