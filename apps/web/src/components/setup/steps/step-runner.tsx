import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { CheckCircleIcon } from "@heroicons/react/24/solid"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { SettingsSection } from "~/components/ui/settings-section"
import { Spinner } from "~/components/ui/spinner"
import { buildRunnerStartCommand } from "~/lib/setup/runner-start-command"
import { isRunnerFreshOnline, pickRunnerName } from "~/lib/setup/runner-status"
import { createRunnerToken } from "~/sdk/runtime"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

type RunnerRow = {
  runnerName: string
  lastStatus: string
  lastSeenAt: number
}

type RunnerConnectionState = "offline" | "connecting" | "ready"

function generateRunnerName(): string {
  return `setup-${Math.random().toString(36).slice(2, 8)}`
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

function resolveRunnerConnectionState(params: {
  runnerOnline: boolean
  repoProbeState: "idle" | "checking" | "ok" | "error"
}): RunnerConnectionState {
  if (!params.runnerOnline) return "offline"
  if (params.repoProbeState === "checking" || params.repoProbeState === "error") return "connecting"
  return "ready"
}

function resolveRepoStatusLabel(state: "idle" | "checking" | "ok" | "error"): string {
  if (state === "ok") return "Reachable"
  if (state === "checking") return "Checking"
  if (state === "error") return "Failed"
  return "Not required"
}

function resolveRunnerStatusLabel(params: {
  runnerOnline: boolean
  runners: RunnerRow[]
}): string {
  if (params.runnerOnline) return "Connected"
  if (params.runners.length > 0) return "Offline"
  return "Waiting"
}

function resolveStatusHint(params: {
  runnerState: RunnerConnectionState
  repoProbeState: "idle" | "checking" | "ok" | "error"
}): string | undefined {
  if (params.runnerState === "offline") {
    return "Runner is offline. Start or restart it to continue setup."
  }
  if (params.runnerState === "connecting" || params.repoProbeState === "error") {
    return "Runner is connected. Repo status updates in the background. Continue with the next step."
  }
  return undefined
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
  const runnerName = pickRunnerName(props.runners, fallbackRunnerName)
  const controlPlaneUrl = String(import.meta.env.VITE_CONVEX_SITE_URL || "").trim()

  const runnerState = resolveRunnerConnectionState({
    runnerOnline: props.runnerOnline,
    repoProbeState: props.repoProbeState,
  })
  const showRemediation = runnerState === "offline"
  const showRepoProbe = props.repoProbeState !== "idle"
  const readyToContinue = props.runnerOnline

  const tokenQuery = useQuery({
    queryKey: ["setup", "runner-token", props.projectId, runnerName, tokenNonce],
    enabled: typeof window !== "undefined" && props.isCurrentStep && showRemediation && Boolean(runnerName.trim()),
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

  const startCommand = buildRunnerStartCommand({
    projectId: String(props.projectId),
    runnerName,
    token,
    repoRoot: props.projectRunnerRepoPath,
    controlPlaneUrl,
  })

  const runnerStatusLabel = resolveRunnerStatusLabel({
    runnerOnline: props.runnerOnline,
    runners: props.runners,
  })
  const repoStatusLabel = resolveRepoStatusLabel(props.repoProbeState)
  const runnerStatusHint = resolveStatusHint({
    runnerState,
    repoProbeState: props.repoProbeState,
  })

  return (
    <SettingsSection
      title="Runner connection"
      description="Runner status is global for this project. Setup continues while runner checks are in progress."
      statusText={runnerStatusHint}
      actions={readyToContinue ? (
        <AsyncButton type="button" size="sm" onClick={props.onContinue}>
          Continue
        </AsyncButton>
      ) : undefined}
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="text-sm font-medium">Readiness</div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>Runner status:</span>
            <Badge variant={props.runnerOnline ? "secondary" : "outline"}>{runnerStatusLabel}</Badge>
            {showRepoProbe ? (
              <>
                <span>Repo probe:</span>
                <Badge variant={props.repoProbeOk ? "secondary" : props.repoProbeState === "error" ? "destructive" : "outline"}>
                  {props.repoProbeState === "checking" ? <Spinner className="mr-1 size-3" /> : null}
                  {repoStatusLabel}
                </Badge>
              </>
            ) : null}
          </div>
          {props.repoProbeState === "error" ? (
            <div className="text-xs text-destructive">{String(props.repoProbeError || "Repo probe failed")}</div>
          ) : null}

          {runnerState === "connecting" ? (
            <Alert className="border-amber-500/35 bg-amber-500/5">
              <Spinner className="size-4 text-amber-600" />
              <AlertTitle>Runner connected</AlertTitle>
              <AlertDescription>
                Checking repo access in the background. No action needed right now.
              </AlertDescription>
            </Alert>
          ) : runnerState === "ready" ? (
            <Alert className="border-emerald-500/35 bg-emerald-500/5">
              <CheckCircleIcon className="text-emerald-600" />
              <AlertTitle>Runner ready</AlertTitle>
              <AlertDescription>
                Runner connection is healthy.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        {showRemediation ? (
          <>
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
          </>
        ) : null}

        {props.runners.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Recent runners</div>
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
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
