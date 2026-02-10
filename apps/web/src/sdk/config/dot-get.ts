import { createServerFn } from "@tanstack/react-start"
import { splitDotPath } from "@clawlets/core/lib/storage/dot-path"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  coerceString,
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseProjectIdInput,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"

export const configDotGet = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, path: coerceString(d["path"]) }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const parts = splitDotPath(data.path)
    const normalizedPath = parts.join(".")
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: `config get ${normalizedPath}`,
      args: ["config", "get", "--path", normalizedPath, "--json"],
      note: "control-plane config read",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 30_000,
    })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId })
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
      throw new Error("config read command result missing JSON payload")
    }
    const path =
      typeof parsed.path === "string" && parsed.path.trim()
        ? parsed.path.trim()
        : normalizedPath
    return { path, value: parsed.value as any }
  })
