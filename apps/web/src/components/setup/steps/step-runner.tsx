import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { CheckCircleIcon } from "@heroicons/react/24/solid"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { Spinner } from "~/components/ui/spinner"
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

function shellQuotePath(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return "''"
  if (trimmed === "~") return "\"$HOME\""
  if (trimmed.startsWith("~/")) {
    return `"${"$HOME"}"${shellQuote(trimmed.slice(1))}`
  }
  return shellQuote(trimmed)
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
  projectRunnerRepoPath?: string | null
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
  const [fallbackRunnerName] = useState(() => generateRunnerName())
  const [tokenNonce, setTokenNonce] = useState(0)
  const runnerName = useMemo(() => {
    const fresh = props.runners.find((runner) => isRunnerFreshOnline(runner) && runner.runnerName.trim())
    if (fresh) return fresh.runnerName.trim()
    const latest = props.runners
      .filter((runner) => runner.runnerName.trim())
      .toSorted((a, b) => b.lastSeenAt - a.lastSeenAt)[0]
    if (latest) return latest.runnerName.trim()
    return fallbackRunnerName
  }, [fallbackRunnerName, props.runners])
  const controlPlaneUrl = String(import.meta.env.VITE_CONVEX_SITE_URL || "").trim()

  const repoProbeRequired = props.repoProbeState !== "idle"
  const connected = props.runnerOnline
  const readyToContinue = connected && props.repoProbeOk

  const tokenQuery = useQuery({
    queryKey: ["setup", "runner-token", props.projectId, runnerName, tokenNonce],
    enabled: typeof window !== "undefined" && props.isCurrentStep && Boolean(runnerName.trim()),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async () => {
      const trimmed = runnerName.trim()
      if (!trimmed) throw new Error("Runner name is required")
      return await createRunnerToken({
        data: {
          projectId: props.projectId,
          runnerName: trimmed,
        },
      })
    },
  })
  const token = String(tokenQuery.data?.token || "")

  const startCommand = useMemo(() => {
    const lines: string[] = []
    const repoRoot = String(props.projectRunnerRepoPath || "").trim()
    const repoRootArg = repoRoot ? shellQuotePath(repoRoot) : shellQuote("<runner-repo-root>")
    lines.push(`mkdir -p ${repoRootArg}`)
    lines.push("clawlets runner start \\")
    lines.push(`  --project ${props.projectId} \\`)
    lines.push(`  --name ${shellQuote(runnerName.trim() || "<runner-name>")} \\`)
    lines.push(`  --token ${shellQuote(token || "<runner-token>")} \\`)
    lines.push(`  --repoRoot ${repoRootArg} \\`)
    lines.push(`  --control-plane-url ${shellQuote(controlPlaneUrl || "<convex-site-url>")}`)
    return lines.join("\n")
  }, [controlPlaneUrl, props.projectId, props.projectRunnerRepoPath, runnerName, token])

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
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-sm font-medium">1. Install CLI</div>
        <pre className="rounded-md border bg-background p-2 text-xs whitespace-pre-wrap break-words">npm install -g clawlets</pre>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium">2. Create runner token</div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground" htmlFor="setup-runner-token">Runner token</label>
          <InputGroup>
            <InputGroupInput
              id="setup-runner-token"
              value={token}
              readOnly
              placeholder={
                tokenQuery.isPending
                  ? "Generating token..."
                  : tokenQuery.isError
                    ? "Token generation failed"
                    : "Token will appear here"
              }
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                variant="secondary"
                pending={tokenQuery.isPending}
                pendingText="Generating"
                disabled={!runnerName.trim()}
                onClick={() => {
                  setTokenNonce((prev) => prev + 1)
                  toast.success("Generating new runner token")
                }}
              >
                <ArrowPathIcon />
                {token ? "Regenerate token" : "Generate token"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <div className="text-xs text-muted-foreground">
            Runner: <code>{runnerName}</code>
          </div>
          {tokenQuery.isError ? (
            <div className="text-xs text-destructive">
              {tokenQuery.error instanceof Error ? tokenQuery.error.message : String(tokenQuery.error)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
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

      <div className="space-y-3">
        <div className="text-sm font-medium">Readiness</div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>Runner status:</span>
          <Badge variant={props.runnerOnline ? "secondary" : "outline"}>{runnerStatusLabel}</Badge>
          <span>Repo probe:</span>
          <Badge variant={props.repoProbeOk ? "secondary" : props.repoProbeState === "error" ? "destructive" : "outline"}>
            {props.repoProbeState === "checking" ? <Spinner className="mr-1 size-3" /> : null}
            {repoStatusLabel}
          </Badge>
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

      {connected ? (
        <div className="space-y-2">
          <Alert className="border-emerald-500/35 bg-emerald-500/5">
            <CheckCircleIcon className="text-emerald-600" />
            <AlertTitle>Runner connected</AlertTitle>
            <AlertDescription>
              {repoProbeRequired
                ? props.repoProbeOk
                  ? "Connection is healthy. Repo probe passed."
                  : props.repoProbeState === "checking"
                    ? (
                        <span className="inline-flex items-center gap-1">
                          <Spinner className="size-3" />
                          Connection is healthy. Checking repo access...
                        </span>
                      )
                    : "Connection is healthy."
                : "Connection is healthy."}
            </AlertDescription>
          </Alert>
          {readyToContinue ? (
            <AsyncButton type="button" size="sm" onClick={props.onContinue}>
              Continue
            </AsyncButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
