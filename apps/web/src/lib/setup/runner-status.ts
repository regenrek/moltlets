export const RUNNER_FRESHNESS_MS = 30_000

export type RunnerPresence = {
  runnerName?: string | null
  lastStatus?: string | null
  lastSeenAt?: number | null
}

export function isRunnerFreshOnline(runner: RunnerPresence, now = Date.now()): boolean {
  if (runner.lastStatus !== "online") return false
  if (typeof runner.lastSeenAt !== "number" || !Number.isFinite(runner.lastSeenAt)) return false
  return now - runner.lastSeenAt < RUNNER_FRESHNESS_MS
}

export function isProjectRunnerOnline(runners: RunnerPresence[] | null | undefined, now = Date.now()): boolean {
  if (!Array.isArray(runners) || runners.length === 0) return false
  return runners.some((runner) => isRunnerFreshOnline(runner, now))
}

export function pickRunnerName(runners: RunnerPresence[] | null | undefined, fallback: string): string {
  if (!Array.isArray(runners) || runners.length === 0) return fallback
  const fresh = runners.find((runner) => {
    if (!isRunnerFreshOnline(runner)) return false
    return typeof runner.runnerName === "string" && runner.runnerName.trim().length > 0
  })
  if (fresh && typeof fresh.runnerName === "string" && fresh.runnerName.trim()) return fresh.runnerName.trim()
  const sorted = [...runners].sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))
  for (const runner of sorted) {
    if (typeof runner.runnerName !== "string") continue
    const name = runner.runnerName.trim()
    if (name) return name
  }
  return fallback
}
