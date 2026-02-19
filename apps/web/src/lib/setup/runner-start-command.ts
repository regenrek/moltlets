export type RunnerStartCommandInput = {
  projectId: string
  runnerName: string
  token: string
  repoRoot: string | null | undefined
  runtimeDir?: string | null | undefined
  controlPlaneUrl: string
  logging?: RunnerStartLogging
}

export type RunnerStartLogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace"
export type RunnerStartLogging = "no-logging" | RunnerStartLogLevel

export const RUNNER_START_LOGGING_OPTIONS: ReadonlyArray<{
  value: RunnerStartLogging
  label: string
  description: string
}> = [
  {
    value: "no-logging",
    label: "No logging",
    description: "Disable file logs and keep level at fatal.",
  },
  {
    value: "info",
    label: "Info (default)",
    description: "Recommended. Lifecycle + error logs.",
  },
  {
    value: "warn",
    label: "Warn",
    description: "Warnings and errors only.",
  },
  {
    value: "error",
    label: "Error",
    description: "Errors only.",
  },
  {
    value: "debug",
    label: "Debug",
    description: "Verbose diagnostics for troubleshooting.",
  },
  {
    value: "trace",
    label: "Trace",
    description: "Maximum verbosity.",
  },
  {
    value: "fatal",
    label: "Fatal",
    description: "Fatal only.",
  },
]

const RUNNER_START_LOGGING_VALUES = new Set<RunnerStartLogging>(RUNNER_START_LOGGING_OPTIONS.map((option) => option.value))

export function parseRunnerStartLogging(raw: unknown, fallback: RunnerStartLogging = "info"): RunnerStartLogging {
  const normalized = String(raw || "").trim() as RunnerStartLogging
  if (RUNNER_START_LOGGING_VALUES.has(normalized)) return normalized
  return fallback
}

function shellQuote(value: string): string {
  if (!value) return "''"
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function shellQuotePath(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return "''"
  if (trimmed === "~") return "\"$HOME\""
  if (trimmed.startsWith("~/")) {
    return `"${"$HOME"}"${shellQuote(trimmed.slice(1))}`
  }
  return shellQuote(trimmed)
}

function safePathSegment(raw: unknown, fallback: string): string {
  const trimmed = String(raw || "").trim()
  const replaced = trimmed.replace(/[^A-Za-z0-9._-]/g, "_")
  const collapsed = replaced.replace(/_+/g, "_").replace(/^_+|_+$/g, "")
  return collapsed || fallback
}

export function resolveRunnerStartRuntimeDir(params: {
  projectId: string
  runnerName: string
}): string {
  return `~/.clawlets/runtime/runner/${safePathSegment(params.projectId, "project")}/${safePathSegment(params.runnerName, "runner")}`
}

export function buildRunnerStartCommand(params: RunnerStartCommandInput): string {
  const lines: string[] = []
  const projectId = String(params.projectId || "").trim() || "<project-id>"
  const runnerName = String(params.runnerName || "").trim() || "<runner-name>"
  const repoRoot = String(params.repoRoot || "").trim()
  const runtimeDir = String(params.runtimeDir || "").trim() || resolveRunnerStartRuntimeDir({ projectId, runnerName })
  const repoRootArg = repoRoot ? shellQuotePath(repoRoot) : shellQuote("<runner-repo-root>")
  const runtimeDirArg = shellQuotePath(runtimeDir)
  const logging = parseRunnerStartLogging(params.logging, "info")
  lines.push(`mkdir -p ${repoRootArg}`)
  lines.push(`mkdir -p ${runtimeDirArg}`)
  lines.push("clawlets runner start \\")
  lines.push(`  --project ${projectId} \\`)
  lines.push(`  --name ${shellQuote(runnerName)} \\`)
  lines.push(`  --token ${shellQuote(params.token || "<runner-token>")} \\`)
  lines.push(`  --repoRoot ${repoRootArg} \\`)
  lines.push(`  --runtime-dir ${runtimeDirArg} \\`)
  if (logging === "no-logging") {
    lines.push("  --no-log-file \\")
    lines.push("  --log-level fatal \\")
  } else {
    lines.push(`  --log-level ${logging} \\`)
  }
  lines.push(`  --control-plane-url ${shellQuote(params.controlPlaneUrl || "<convex-site-url>")}`)
  return lines.join("\n")
}
