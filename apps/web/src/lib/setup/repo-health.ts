import { redactKnownSecretsText } from "@clawlets/core/lib/runtime/redaction"

export type RepoHealthState = "idle" | "checking" | "ok" | "error"

export type RepoHealth = {
  state: RepoHealthState
  error?: string
}

type ProjectConfigSummary = {
  type?: string | null
  lastSyncAt?: number | null
  lastError?: string | null
}

export const REPO_HEALTH_FRESH_MS = 15 * 60_000

function trimOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

function sanitizeRepoHealthError(value: unknown): string {
  const trimmed = trimOrEmpty(value)
  if (!trimmed) return ""
  return redactKnownSecretsText(trimmed).trim()
}

export function deriveRepoHealth(params: {
  runnerOnline: boolean
  configs: ProjectConfigSummary[] | null | undefined
  now?: number
  freshMs?: number
}): RepoHealth {
  if (!params.runnerOnline) return { state: "idle" }

  const configs = Array.isArray(params.configs) ? params.configs : []
  const fleetConfig = configs.find((row) => trimOrEmpty(row?.type) === "fleet") ?? null
  if (!fleetConfig) return { state: "checking" }

  const error = sanitizeRepoHealthError(fleetConfig.lastError)
  if (error) return { state: "error", error }

  const now = asFiniteNumber(params.now) ?? Date.now()
  const freshMs = Math.max(1, Math.trunc(asFiniteNumber(params.freshMs) ?? REPO_HEALTH_FRESH_MS))
  const lastSyncAt = asFiniteNumber(fleetConfig.lastSyncAt)
  if (lastSyncAt === null) return { state: "checking" }
  if (now - lastSyncAt > freshMs) return { state: "checking" }
  return { state: "ok" }
}

export type RunnerHeaderState = "offline" | "connecting" | "ready"

export function deriveRunnerHeaderState(params: {
  runnerOnline: boolean
  repoHealthState: RepoHealthState
}): RunnerHeaderState {
  if (!params.runnerOnline) return "offline"
  if (params.repoHealthState === "ok") return "ready"
  return "connecting"
}
