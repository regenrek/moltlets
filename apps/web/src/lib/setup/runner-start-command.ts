export type RunnerStartCommandInput = {
  projectId: string
  runnerName: string
  token: string
  repoRoot: string | null | undefined
  controlPlaneUrl: string
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

export function buildRunnerStartCommand(params: RunnerStartCommandInput): string {
  const lines: string[] = []
  const repoRoot = String(params.repoRoot || "").trim()
  const repoRootArg = repoRoot ? shellQuotePath(repoRoot) : shellQuote("<runner-repo-root>")
  lines.push(`mkdir -p ${repoRootArg}`)
  lines.push("clawlets runner start \\")
  lines.push(`  --project ${params.projectId} \\`)
  lines.push(`  --name ${shellQuote(params.runnerName.trim() || "<runner-name>")} \\`)
  lines.push(`  --token ${shellQuote(params.token || "<runner-token>")} \\`)
  lines.push(`  --repoRoot ${repoRootArg} \\`)
  lines.push(`  --control-plane-url ${shellQuote(params.controlPlaneUrl || "<convex-site-url>")}`)
  return lines.join("\n")
}
