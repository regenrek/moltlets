import { createServerFn } from "@tanstack/react-start"
import {
  ClawletsConfigSchema,
} from "@clawlets/core/lib/config/clawlets-config"
import { createConvexClient } from "~/server/convex"
import { findGatewayOpenclawChanges } from "./helpers"
import {
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseLastJsonMessage,
  parseProjectIdInput,
  waitForRunTerminal,
} from "~/sdk/runtime"
import type { ValidationIssue } from "~/sdk/runtime"
import { requireAdminProjectAccess } from "~/sdk/project"

type ClawletsConfigReadResult = {
  configPath: string
  config: any
  json: string
  missing?: boolean
}

function toIssues(message: string): ValidationIssue[] {
  return [{ code: "error", path: [], message }]
}

export const getClawletsConfig = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    return parseProjectIdInput(data)
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: "config show",
      args: ["config", "show", "--pretty=false"],
      note: "control-plane config read",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 30_000,
    })
    const messages = await listRunMessages({ client, runId: queued.runId })
    if (terminal.status !== "succeeded") {
      const message = terminal.errorMessage || lastErrorMessage(messages, "config read failed")
      if (/missing clawlets config|missing config|not found/i.test(message)) {
        return {
          configPath: "fleet/clawlets.json",
          config: null,
          json: "",
          missing: true,
        } satisfies ClawletsConfigReadResult
      }
      throw new Error(message)
    }
    const parsed = parseLastJsonMessage<Record<string, unknown>>(messages)
    if (!parsed) {
      throw new Error(lastErrorMessage(messages, "config show output missing JSON payload"))
    }
    const json = `${JSON.stringify(parsed, null, 2)}\n`
    return {
      configPath: "fleet/clawlets.json",
      config: parsed as any,
      json,
      missing: false,
    } satisfies ClawletsConfigReadResult
  })

export const writeClawletsConfigFile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
      return {
        ...base,
        next: d["next"] as unknown,
        title: typeof d["title"] === "string" ? d["title"] : "Update fleet config",
      }
    })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const parsed = ClawletsConfigSchema.safeParse(data.next)
    if (!parsed.success) {
      return {
        ok: false as const,
        issues: parsed.error.issues.map((issue) => ({
          code: String(issue.code || "invalid"),
          path: Array.isArray(issue.path) ? issue.path : [],
          message: String(issue.message || "invalid config"),
        })),
      }
    }

    const currentRead = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: "config show",
      args: ["config", "show", "--pretty=false"],
      note: "policy preflight",
    })
    const currentTerminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: currentRead.runId,
      timeoutMs: 30_000,
    })
    const currentMessages = await listRunMessages({ client, runId: currentRead.runId })
    if (currentTerminal.status === "succeeded") {
      const currentConfig = parseLastJsonMessage<Record<string, unknown>>(currentMessages)
      if (currentConfig) {
        const blocked = findGatewayOpenclawChanges(currentConfig, parsed.data)
        if (blocked) {
          return {
            ok: false as const,
            issues: [{ code: "policy", path: blocked.path, message: blocked.message }],
          }
        }
      }
    }

    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "config_write",
      title: data.title,
      args: ["config", "replace", "--config-json", JSON.stringify(parsed.data)],
      note: "control-plane full config write",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 60_000,
    })
    if (terminal.status !== "succeeded") {
      const messages = await listRunMessages({ client, runId: queued.runId })
      return { ok: false as const, issues: toIssues(terminal.errorMessage || lastErrorMessage(messages, "config update failed")) }
    }
    return { ok: true as const, runId: queued.runId }
  })
