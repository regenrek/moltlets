import { createServerFn } from "@tanstack/react-start"
import { createConvexClient } from "~/server/convex"
import { requireAdminProjectAccess } from "~/sdk/project"
import {
  enqueueRunnerCommand,
  lastErrorMessage,
  listRunMessages,
  parseProjectHostRequiredInput,
  parseProjectIdInput,
  takeRunnerCommandResultObject,
  waitForRunTerminal,
} from "~/sdk/runtime"

export type GitRepoStatus = {
  branch: string | null
  upstream: string | null
  localHead: string | null
  originDefaultRef: string | null
  originHead: string | null
  dirty: boolean
  ahead: number | null
  behind: number | null
  detached: boolean
  needsPush: boolean
  canPush: boolean
  pushBlockedReason?: string
}

export type GitSetupSaveResult = {
  ok: true
  host: string
  branch: string
  sha: string | null
  committed: boolean
  pushed: boolean
  changedPaths: string[]
}

export const gitRepoStatus = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: "Git status",
      args: ["git", "status", "--json"],
      note: "control-plane git status read",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 25_000,
    })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId, limit: 300 })
    if (terminal.status !== "succeeded") {
      throw new Error(terminal.errorMessage || lastErrorMessage(messages, "git status failed"))
    }
    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (!parsed) throw new Error("git status command result missing JSON payload")

    const aheadRaw = parsed.ahead
    const behindRaw = parsed.behind
    const ahead = typeof aheadRaw === "number" ? Math.max(0, Math.trunc(aheadRaw)) : null
    const behind = typeof behindRaw === "number" ? Math.max(0, Math.trunc(behindRaw)) : null

    return {
      branch: typeof parsed.branch === "string" ? parsed.branch : null,
      upstream: typeof parsed.upstream === "string" ? parsed.upstream : null,
      localHead: typeof parsed.localHead === "string" ? parsed.localHead : null,
      originDefaultRef: typeof parsed.originDefaultRef === "string" ? parsed.originDefaultRef : null,
      originHead: typeof parsed.originHead === "string" ? parsed.originHead : null,
      dirty: Boolean(parsed.dirty),
      ahead,
      behind,
      detached: Boolean(parsed.detached),
      needsPush: Boolean(parsed.needsPush),
      canPush: Boolean(parsed.canPush),
      pushBlockedReason: typeof parsed.pushBlockedReason === "string" ? parsed.pushBlockedReason : undefined,
    } satisfies GitRepoStatus
  })

export const gitPushExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "git_push",
      title: "Git push",
      args: ["git", "push"],
      note: "control-plane git push request",
    })
    return { ok: true as const, queued: true as const, runId: queued.runId, jobId: queued.jobId }
  })

export const gitSetupSaveExecute = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostRequiredInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)
    const queued = await enqueueRunnerCommand({
      client,
      projectId: data.projectId,
      runKind: "custom",
      title: `Save setup changes (${data.host})`,
      args: ["git", "setup-save", "--host", data.host, "--json"],
      note: "control-plane git setup-save request",
    })
    const terminal = await waitForRunTerminal({
      client,
      projectId: data.projectId,
      runId: queued.runId,
      timeoutMs: 120_000,
    })
    const messages = terminal.status === "succeeded" ? [] : await listRunMessages({ client, runId: queued.runId, limit: 300 })
    if (terminal.status !== "succeeded") {
      throw new Error(terminal.errorMessage || lastErrorMessage(messages, "git setup-save failed"))
    }
    const parsed = await takeRunnerCommandResultObject({
      client,
      projectId: data.projectId,
      jobId: queued.jobId,
      runId: queued.runId,
    })
    if (!parsed) throw new Error("git setup-save result missing JSON payload")
    const changedPaths = Array.isArray(parsed.changedPaths)
      ? parsed.changedPaths.filter((p0) => typeof p0 === "string").map((p0) => p0.trim()).filter(Boolean)
      : []
    const result: GitSetupSaveResult = {
      ok: true,
      host: typeof parsed.host === "string" ? parsed.host : data.host,
      branch: typeof parsed.branch === "string" ? parsed.branch : "",
      sha: typeof parsed.sha === "string" ? parsed.sha : null,
      committed: Boolean(parsed.committed),
      pushed: Boolean(parsed.pushed),
      changedPaths,
    }
    if (!result.branch) throw new Error("git setup-save missing branch")
    return { ok: true as const, runId: queued.runId, jobId: queued.jobId, result }
  })

