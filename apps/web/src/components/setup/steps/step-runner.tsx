import { useMutation } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { isRunnerFreshOnline } from "~/lib/setup/runner-status"
import { createRunnerToken } from "~/sdk/runtime"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

type RunnerRow = {
  runnerName: string
  lastStatus: string
  lastSeenAt: number
}

function generateRunnerName(): string {
  return `setup-${Math.random().toString(36).slice(2, 8)}`
}

function shellQuote(value: string): string {
  if (!value) return "''"
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function copyText(label: string, value: string): Promise<void> {
  if (!value.trim()) {
    toast.error(`${label} is empty`)
    return
  }
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("Clipboard unavailable")
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error("Copy failed")
  }
}

export function SetupStepRunner(props: {
  projectId: Id<"projects">
  projectLocalPath?: string | null
  host: string
  stepStatus: SetupStepStatus
  isCurrentStep: boolean
  runnerOnline: boolean
  repoProbeOk: boolean
  repoProbeState: "idle" | "checking" | "ok" | "error"
  repoProbeError: unknown
  runners: RunnerRow[]
  onContinue: () => void
}) {
  const [runnerName, setRunnerName] = useState(() => generateRunnerName())
  const [token, setToken] = useState("")
  const wasReadyRef = useRef(false)

  const controlPlaneUrl = String(import.meta.env.VITE_CONVEX_SITE_URL || "").trim()
  const dashboardOrigin = typeof window === "undefined" ? "" : String(window.location.origin || "").trim()

  useEffect(() => {
    const ready = props.runnerOnline && props.repoProbeOk
    if (props.isCurrentStep && ready && !wasReadyRef.current) {
      props.onContinue()
    }
    wasReadyRef.current = ready
  }, [props.isCurrentStep, props.onContinue, props.repoProbeOk, props.runnerOnline])

  const createToken = useMutation({
    mutationFn: async () => {
      const trimmed = runnerName.trim()
      if (!trimmed) throw new Error("Runner name is required")
      return await createRunnerToken({
        data: {
          projectId: props.projectId,
          runnerName: trimmed,
        },
      })
    },
    onSuccess: (res) => {
      setToken(String(res.token || ""))
      toast.success("Runner token created")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const startCommand = useMemo(() => {
    const lines: string[] = []
    const projectPath = String(props.projectLocalPath || "").trim()
    lines.push(`cd ${projectPath ? shellQuote(projectPath) : "<project-repo-root>"}`)
    lines.push("clawlets runner start \\")
    lines.push(`  --project ${props.projectId} \\`)
    lines.push(`  --name ${shellQuote(runnerName.trim() || "<runner-name>")} \\`)
    lines.push(`  --token ${shellQuote(token || "<runner-token>")} \\`)
    lines.push(`  --control-plane-url ${shellQuote(controlPlaneUrl || "<convex-site-url>")} \\`)
    lines.push(`  --dashboardOrigin ${shellQuote(dashboardOrigin || "<dashboard-origin>")}`)
    return lines.join("\n")
  }, [controlPlaneUrl, dashboardOrigin, props.projectId, props.projectLocalPath, runnerName, token])

  const runnerStatusLabel = props.runnerOnline
    ? "Connected"
    : props.runners.length > 0
      ? "Offline"
      : "Waiting"

  const repoStatusLabel = props.repoProbeState === "ok"
    ? "Reachable"
    : props.repoProbeState === "checking"
      ? "Checking"
      : props.repoProbeState === "error"
        ? "Failed"
        : "Waiting"

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <div className="text-sm font-medium">1. Install CLI</div>
        <pre className="text-xs whitespace-pre-wrap break-words">npm install -g clawlets</pre>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
        <div className="text-sm font-medium">2. Create runner token</div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground" htmlFor="setup-runner-name">Runner name</label>
          <Input
            id="setup-runner-name"
            value={runnerName}
            onChange={(e) => setRunnerName(e.target.value)}
            placeholder="setup-xxxxxx"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton
            type="button"
            disabled={createToken.isPending || !runnerName.trim()}
            pending={createToken.isPending}
            pendingText={token ? "Generating new token..." : "Creating token..."}
            onClick={() => createToken.mutate()}
          >
            {token ? "Generate new token" : "Create token"}
          </AsyncButton>
          {token ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void copyText("Token", token)}>
              Copy token
            </Button>
          ) : null}
        </div>
        {token ? (
          <pre className="rounded-md border bg-background p-2 text-xs break-all">{token}</pre>
        ) : (
          <div className="text-xs text-muted-foreground">Create token to unlock the start command.</div>
        )}
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium">3. Start runner</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!token}
            onClick={() => void copyText("Runner command", startCommand)}
          >
            Copy command
          </Button>
        </div>
        <pre className="rounded-md border bg-background p-2 text-xs whitespace-pre-wrap break-words">{startCommand}</pre>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
        <div className="text-sm font-medium">Readiness</div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>Runner status:</span>
          <Badge variant={props.runnerOnline ? "secondary" : "outline"}>{runnerStatusLabel}</Badge>
          <span>Repo probe:</span>
          <Badge variant={props.repoProbeOk ? "secondary" : props.repoProbeState === "error" ? "destructive" : "outline"}>
            {repoStatusLabel}
          </Badge>
          <span className="text-muted-foreground">(checks <code>hosts.{props.host}</code>)</span>
        </div>
        {props.repoProbeState === "error" ? (
          <div className="text-xs text-destructive">{String(props.repoProbeError || "Repo probe failed")}</div>
        ) : null}
        {props.runners.length > 0 ? (
          <div className="space-y-1">
            {props.runners.slice(0, 5).map((runner) => {
              const fresh = isRunnerFreshOnline(runner)
              return (
                <div key={`${runner.runnerName}-${runner.lastSeenAt}`} className="flex items-center justify-between gap-2 text-xs rounded-md border bg-background px-2 py-1">
                  <code>{runner.runnerName}</code>
                  <span className="text-muted-foreground">
                    {runner.lastStatus} · {fresh ? "fresh" : "stale"} · {new Date(runner.lastSeenAt).toLocaleTimeString()}
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {props.stepStatus === "done" ? (
        <div className="text-xs text-muted-foreground">Runner connected. Setup unlocks automatically.</div>
      ) : null}
    </div>
  )
}
