import type { RunnerHeaderState } from "~/lib/setup/repo-health"

export type RunnerConnectionToastKind = "connecting" | "ready" | "offline"

export const RUNNER_CONNECTING_TOAST_DELAY_MS = 1500

export const RUNNER_CONNECTION_TOAST_MESSAGES: Record<RunnerConnectionToastKind, string> = {
  connecting: "Runner is connecting in the background.",
  ready: "Runner is ready.",
  offline: "Runner went offline. Reconnect to continue deploy and secrets operations.",
}

export function deriveRunnerConnectionToastKind(params: {
  previous: RunnerHeaderState | null
  next: RunnerHeaderState
}): RunnerConnectionToastKind | null {
  if (!params.previous) return null
  if (params.previous === params.next) return null
  return params.next
}
