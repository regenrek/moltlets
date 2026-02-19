export type DeploySource = "local" | "remote"
export type DeployReadinessReason =
  | "runner_offline"
  | "repo_pending"
  | "repo_error"
  | "dirty_repo"
  | "missing_remote_rev"
  | "missing_local_rev"
  | "needs_push"
  | "ready"

export type DeployReadinessSeverity = "info" | "warning" | "error"

export type DeployReadiness = {
  reason: DeployReadinessReason
  message: string
  title?: string
  detail?: string
  severity: DeployReadinessSeverity
  blocksDeploy: boolean
  showFirstPushGuidance: boolean
}

export type FirstPushGuidance = {
  remoteName: string
  hasUpstream: boolean
  repoPath: string
  repoUrlHint?: string
  commands: string
  note: string
}

export type FinalizeStepId =
  | "enableHost"
  | "setTargetHost"
  | "switchTailnetTarget"
  | "switchSshExposure"
  | "lockdown"
  | "applyUpdates"

export type FinalizeStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped"
export type FinalizeState = "idle" | "running" | "succeeded" | "failed"

export type FinalizeStep = {
  id: FinalizeStepId
  label: string
  status: FinalizeStepStatus
  detail?: string
}

export const FINALIZE_STEP_ORDER: Array<{ id: FinalizeStepId; label: string }> = [
  { id: "enableHost", label: "Enable host" },
  { id: "setTargetHost", label: "Set target host" },
  { id: "switchTailnetTarget", label: "Switch target host to tailnet" },
  { id: "switchSshExposure", label: "Switch SSH exposure to tailnet" },
  { id: "lockdown", label: "Run lockdown" },
  { id: "applyUpdates", label: "Apply updates" },
]

export function initialFinalizeSteps(): FinalizeStep[] {
  return FINALIZE_STEP_ORDER.map((step) => ({ id: step.id, label: step.label, status: "pending" }))
}

export function deriveDeployReadiness(params: {
  runnerOnline: boolean
  repoPending: boolean
  repoError: unknown
  dirty: boolean
  missingRev: boolean
  needsPush: boolean
  localSelected: boolean
  allowLocalDeploy?: boolean
}): DeployReadiness {
  const allowLocalDeploy = params.allowLocalDeploy !== false
  if (!params.runnerOnline) {
    return {
      reason: "runner_offline",
      message: "Start runner first.",
      title: "Runner offline",
      detail: "Repo checks and deploy are blocked until a runner is connected.",
      severity: "error",
      blocksDeploy: true,
      showFirstPushGuidance: false,
    }
  }
  if (params.repoPending) {
    return {
      reason: "repo_pending",
      message: "Checking repo state...",
      severity: "info",
      blocksDeploy: true,
      showFirstPushGuidance: false,
    }
  }
  if (params.repoError) {
    return {
      reason: "repo_error",
      message: "Could not read repo state.",
      title: "Repo state unavailable",
      detail: "Refresh and retry. If this persists, check runner logs.",
      severity: "error",
      blocksDeploy: true,
      showFirstPushGuidance: false,
    }
  }
  if (params.dirty) {
    return {
      reason: "dirty_repo",
      message: "Uncommitted changes detected. Commit and push before deploying.",
      title: "Repo has uncommitted changes",
      detail: "Deploy pins a git revision. Uncommitted changes are ignored until saved to git.",
      severity: "warning",
      blocksDeploy: true,
      showFirstPushGuidance: false,
    }
  }
  if (params.missingRev) {
    if (params.localSelected) {
      return {
        reason: "missing_local_rev",
        message: "Local HEAD missing. Refresh repo state.",
        title: "Local revision unavailable",
        detail: "We could not resolve your local HEAD revision.",
        severity: "error",
        blocksDeploy: true,
        showFirstPushGuidance: false,
      }
    }
    return {
      reason: "missing_remote_rev",
      message: allowLocalDeploy
        ? "No pushed revision found. Push once, or switch to Local deploy."
        : "No pushed revision found. Push your default branch, then refresh.",
      title: "No pushed revision found",
      detail: "Deploy needs one pushed commit on your remote.",
      severity: "error",
      blocksDeploy: true,
      showFirstPushGuidance: true,
    }
  }
  if (params.needsPush) {
    if (params.localSelected) {
      return {
        reason: "needs_push",
        message: "Local deploy requires pushing your commit first.",
        title: "Local commit not on remote",
        detail: "Push required so the host can fetch this revision.",
        severity: "warning",
        blocksDeploy: true,
        showFirstPushGuidance: true,
      }
    }
    return {
      reason: "needs_push",
      message: "Unpushed commits detected. Push before deploying.",
      title: "Push required",
      detail: "Remote deploy uses the last pushed revision, not your local commit.",
      severity: "warning",
      blocksDeploy: true,
      showFirstPushGuidance: true,
    }
  }
  return {
    reason: "ready",
    message: "Ready to deploy.",
    severity: "info",
    blocksDeploy: false,
    showFirstPushGuidance: false,
  }
}

export function formatStatusReason(params: {
  runnerOnline: boolean
  repoPending: boolean
  repoError: unknown
  dirty: boolean
  missingRev: boolean
  needsPush: boolean
  localSelected: boolean
}): string {
  return deriveDeployReadiness(params).message
}

function parseUpstreamRemote(upstream?: string | null): string | null {
  const value = String(upstream || "").trim()
  if (!value) return null
  const slash = value.indexOf("/")
  if (slash <= 0) return null
  const remoteName = value.slice(0, slash).trim()
  return remoteName || null
}

function shellQuote(value: string): string {
  if (!value) return "''"
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function shellQuotePath(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return "''"
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed
  if (trimmed === "~") return "\"$HOME\""
  if (trimmed.startsWith("~/")) {
    return `"${"$HOME"}"${shellQuote(trimmed.slice(1))}`
  }
  return shellQuote(trimmed)
}

function resolveRunnerRepoPathHint(value: unknown): string {
  const trimmed = String(value || "").trim()
  return trimmed || "<runner-repo-path>"
}

function resolveRepoUrlHint(value: unknown): string | null {
  const trimmed = String(value || "").trim()
  return trimmed || null
}

export function deriveFirstPushGuidance(params: {
  upstream?: string | null
  runnerRepoPath?: string | null
  repoUrlHint?: string | null
}): FirstPushGuidance {
  const parsedRemote = parseUpstreamRemote(params.upstream)
  const remoteName = parsedRemote || "origin"
  const hasUpstream = Boolean(parsedRemote)
  const repoPath = resolveRunnerRepoPathHint(params.runnerRepoPath)
  const repoUrlHint = resolveRepoUrlHint(params.repoUrlHint)
  const repoUrlValue = repoUrlHint || "<repo-url>"
  const quotedRepoUrl = repoUrlHint ? shellQuote(repoUrlHint) : repoUrlValue
  const commands = hasUpstream
    ? [
      `cd ${shellQuotePath(repoPath)}`,
      "git push",
    ].join("\n")
    : [
      `cd ${shellQuotePath(repoPath)}`,
      `git remote add origin ${quotedRepoUrl}`,
      "# if origin already exists, update it first",
      `git remote set-url origin ${quotedRepoUrl}`,
      "git push -u origin HEAD",
    ].join("\n")
  return {
    remoteName,
    hasUpstream,
    repoPath,
    ...(repoUrlHint ? { repoUrlHint } : {}),
    commands,
    note: "Run on the runner host in this repo path. Auth uses local git credentials (SSH key, token, or GitHub app).",
  }
}

export function stepBadgeVariant(status: FinalizeStepStatus): "outline" | "secondary" | "destructive" {
  if (status === "succeeded" || status === "skipped") return "secondary"
  if (status === "failed") return "destructive"
  return "outline"
}

export function stepBadgeLabel(status: FinalizeStepStatus): string {
  if (status === "pending") return "pending"
  if (status === "running") return "running"
  if (status === "succeeded") return "done"
  if (status === "failed") return "failed"
  return "skipped"
}

export function extractIssueMessage(result: unknown, fallback: string): string {
  const row = result as { issues?: Array<{ message?: string }> } | null
  const first = row?.issues?.[0]
  const message = typeof first?.message === "string" ? first.message.trim() : ""
  return message || fallback
}
