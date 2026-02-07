import { createServerFn } from "@tanstack/react-start"
import {
  ClawletsConfigSchema,
  loadClawletsConfig,
  loadFullConfig,
  writeClawletsConfig,
} from "@clawlets/core/lib/config/clawlets-config"
import { splitDotPath } from "@clawlets/core/lib/storage/dot-path"
import { deleteAtPath, getAtPath, setAtPath } from "@clawlets/core/lib/storage/object-path"
import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawletsEnvTokens } from "~/server/redaction"
import { GATEWAY_OPENCLAW_POLICY_MESSAGE, isGatewayOpenclawPath } from "./helpers"
import { getAdminProjectContext } from "~/sdk/project"
import { mapValidationIssues, runWithEventsAndStatus, type ValidationIssue } from "~/sdk/runtime/server"
import { parseProjectIdInput } from "~/sdk/runtime"

export const configDotGet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, path: String(d["path"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config } = loadClawletsConfig({ repoRoot })
    const parts = splitDotPath(data.path)
    const value = getAtPath(config as any, parts)
    return { path: parts.join("."), value: value as any }
  })

export const configDotSet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const path = String(d["path"] || "").trim()
    if (!path) throw new Error("missing path")
    const value = d["value"] === undefined ? undefined : String(d["value"])
    const valueJson = d["valueJson"] === undefined ? undefined : String(d["valueJson"])
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
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { infraConfigPath, config } = loadFullConfig({ repoRoot })
    const parts = splitDotPath(data.path)
    const next = structuredClone(config) as any

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

    if (data.del) {
      const ok = deleteAtPath(next, parts)
      if (!ok) throw new Error(`path not found: ${parts.join(".")}`)
    } else if (data.valueJson !== undefined) {
      let parsed: unknown
      try {
        parsed = JSON.parse(data.valueJson)
      } catch {
        throw new Error("invalid JSON value")
      }
      setAtPath(next, parts, parsed)
    } else if (data.value !== undefined) {
      setAtPath(next, parts, data.value)
    } else {
      throw new Error("missing value (or set del=true)")
    }

    const validated = ClawletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `config set ${parts.join(".")}`,
    })

    type ConfigDotResult = { ok: true; runId: typeof runId } | { ok: false; issues: ValidationIssue[] }

    return await runWithEventsAndStatus<ConfigDotResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating ${parts.join(".")}` })
        await writeClawletsConfig({ configPath: infraConfigPath, config: validated.data })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
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
      const path = String(o["path"] || "")
      const del = Boolean(o["del"])
      const value = o["value"] === undefined ? undefined : String(o["value"])
      const valueJson = o["valueJson"] === undefined ? undefined : String(o["valueJson"])
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
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { infraConfigPath, config } = loadFullConfig({ repoRoot })
    const next = structuredClone(config) as any

    const plannedPaths: string[] = []

    for (const op of data.ops) {
      const parts = splitDotPath(op.path)
      plannedPaths.push(parts.join("."))

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

      if (op.del) {
        const ok = deleteAtPath(next, parts)
        if (!ok) throw new Error(`path not found: ${parts.join(".")}`)
        continue
      }

      if (op.valueJson !== undefined) {
        let parsed: unknown
        try {
          parsed = JSON.parse(op.valueJson)
        } catch {
          throw new Error(`invalid JSON value at ${parts.join(".")}`)
        }
        setAtPath(next, parts, parsed)
        continue
      }

      if (op.value !== undefined) {
        setAtPath(next, parts, op.value)
        continue
      }

      throw new Error(`missing value (or set del=true) for ${parts.join(".")}`)
    }

    const validated = ClawletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const title =
      plannedPaths.length === 1
        ? `config set ${plannedPaths[0] || "unknown"}`
        : `config set ${plannedPaths[0] || "unknown"} (+${plannedPaths.length - 1} more)`

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title,
    })

    type ConfigDotBatchResult = { ok: true; runId: typeof runId } | { ok: false; issues: ValidationIssue[] }

    return await runWithEventsAndStatus<ConfigDotBatchResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating ${plannedPaths.length} config path(s)` })
        await writeClawletsConfig({ configPath: infraConfigPath, config: validated.data })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })
