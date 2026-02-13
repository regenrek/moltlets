import type { RunnerHeaderState } from "~/lib/setup/repo-health"

export type RunnerDialogView = {
  description: string
  statusHint: string
  showRemediation: boolean
}

export function deriveRunnerDialogView(state: RunnerHeaderState): RunnerDialogView {
  if (state === "offline") {
    return {
      description: "Runner is offline. Start or restart it to restore deploy and secrets operations.",
      statusHint: "Runner is offline. Use the setup actions below to reconnect.",
      showRemediation: true,
    }
  }
  if (state === "connecting") {
    return {
      description: "Connection status is global for this project. Runner is connecting in the background.",
      statusHint: "Runner is connecting. No action needed right now.",
      showRemediation: false,
    }
  }
  return {
    description: "Connection status is global for this project. Runner is healthy and ready.",
    statusHint: "Runner is healthy. No action needed right now.",
    showRemediation: false,
  }
}
