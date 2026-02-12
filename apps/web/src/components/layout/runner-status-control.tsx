import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { Spinner } from "~/components/ui/spinner"
import {
  deriveRunnerConnectionToastKind,
  RUNNER_CONNECTING_TOAST_DELAY_MS,
  RUNNER_CONNECTION_TOAST_MESSAGES,
} from "~/lib/setup/runner-connection-toast"
import { deriveRunnerDialogView } from "~/lib/setup/runner-dialog-view"
import { deriveRepoProbeState, deriveRunnerHeaderState, setupConfigProbeQueryOptions } from "~/lib/setup/repo-probe"
import { buildRunnerStartCommand } from "~/lib/setup/runner-start-command"
import { isProjectRunnerOnline, isRunnerFreshOnline, pickRunnerName } from "~/lib/setup/runner-status"
import { createRunnerToken } from "~/sdk/runtime"

type RunnerStatusControlProps = {
  projectId: Id<"projects">
  projectSlug: string
  projectStatus?: string | null
  projectRunnerRepoPath?: string | null
}

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

function runnerStateLabel(state: "offline" | "connecting" | "ready"): string {
  if (state === "ready") return "Ready"
  if (state === "connecting") return "Connecting"
  return "Offline"
}

function runnerStateDotClass(state: "offline" | "connecting" | "ready"): string {
  if (state === "ready") return "bg-emerald-500"
  if (state === "connecting") return "bg-amber-500 animate-pulse"
  return "bg-muted-foreground/70"
}

export function RunnerStatusControl(props: RunnerStatusControlProps) {
  const [open, setOpen] = useState(false)
  const [fallbackRunnerName] = useState(() => generateRunnerName())
  const [tokenNonce, setTokenNonce] = useState(0)
  const previousStateRef = useRef<"offline" | "connecting" | "ready" | null>(null)
  const connectingToastTimerRef = useRef<number | null>(null)
  const initializedStateRef = useRef(false)

  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
  })
  const runners = runnersQuery.data ?? []
  const runnerOnline = isProjectRunnerOnline(runners)

  const repoProbeQuery = useQuery({
    ...setupConfigProbeQueryOptions(props.projectId),
    enabled: props.projectStatus === "ready" && runnerOnline,
  })
  const repoProbeState = deriveRepoProbeState({
    runnerOnline,
    hasConfig: Boolean(repoProbeQuery.data),
    hasError: repoProbeQuery.isError,
  })
  let state = deriveRunnerHeaderState({ runnerOnline, repoProbeState })
  if (runnersQuery.isPending && runners.length === 0) state = "connecting"
  const dialogView = deriveRunnerDialogView(state)
  const showRemediation = dialogView.showRemediation

  const clearConnectingToastTimer = () => {
    if (connectingToastTimerRef.current !== null) {
      window.clearTimeout(connectingToastTimerRef.current)
      connectingToastTimerRef.current = null
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    if (runnersQuery.isPending) return
    if (!initializedStateRef.current) {
      initializedStateRef.current = true
      previousStateRef.current = state
      return
    }

    const previous = previousStateRef.current
    previousStateRef.current = state
    const toastKind = deriveRunnerConnectionToastKind({ previous, next: state })
    if (!toastKind) return

    if (toastKind === "connecting") {
      clearConnectingToastTimer()
      connectingToastTimerRef.current = window.setTimeout(() => {
        toast.info(RUNNER_CONNECTION_TOAST_MESSAGES.connecting)
        connectingToastTimerRef.current = null
      }, RUNNER_CONNECTING_TOAST_DELAY_MS)
      return
    }

    clearConnectingToastTimer()
    if (toastKind === "ready") {
      toast.success(RUNNER_CONNECTION_TOAST_MESSAGES.ready)
    } else {
      toast.error(RUNNER_CONNECTION_TOAST_MESSAGES.offline)
    }
  }, [runnersQuery.isPending, state])

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return
      if (connectingToastTimerRef.current !== null) {
        window.clearTimeout(connectingToastTimerRef.current)
        connectingToastTimerRef.current = null
      }
    }
  }, [])

  const runnerName = pickRunnerName(runners, fallbackRunnerName)
  const controlPlaneUrl = String(import.meta.env.VITE_CONVEX_SITE_URL || "").trim()
  const tokenQuery = useQuery({
    queryKey: ["header", "runner-token", props.projectId, runnerName, tokenNonce],
    enabled: open && showRemediation && Boolean(runnerName.trim()),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
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

  const setupHref = `/${props.projectSlug}/runner`
  const tokensHref = `/${props.projectSlug}/security/api-keys`
  const sshHref = `/${props.projectSlug}/security/ssh-keys`

  const repoStatusLabel = repoProbeState === "ok"
    ? "Reachable"
    : repoProbeState === "checking"
      ? "Checking"
      : repoProbeState === "error"
        ? "Failed"
        : "Waiting"
  const runnerStatusLabel = runnerOnline
    ? "Connected"
    : runners.length > 0
      ? "Offline"
      : "Waiting"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            size="sm"
            className="ml-auto h-8 gap-2 px-2.5"
          >
            <span className={`size-2 rounded-full ${runnerStateDotClass(state)}`} aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Runner</span>
            <span className="text-xs font-medium">{runnerStateLabel(state)}</span>
          </Button>
        )}
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Runner status</DialogTitle>
          <DialogDescription>{dialogView.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Runner</span>
            <Badge
              variant="outline"
              className={runnerOnline ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : undefined}
            >
              {runnerStatusLabel}
            </Badge>
            <span className="text-muted-foreground">Repo</span>
            <Badge
              variant={repoProbeState === "error" ? "destructive" : "outline"}
              className={repoProbeState === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : undefined}
            >
              {repoProbeState === "checking" ? <Spinner className="mr-1 size-3" /> : null}
              {repoStatusLabel}
            </Badge>
          </div>

          <div className="text-xs text-muted-foreground">{dialogView.statusHint}</div>

          {repoProbeQuery.isError ? (
            <div className="text-xs text-destructive">
              {repoProbeQuery.error instanceof Error ? repoProbeQuery.error.message : String(repoProbeQuery.error)}
            </div>
          ) : null}

          {showRemediation ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<a href={tokensHref} />}
                >
                  Manage tokens
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<a href={sshHref} />}
                >
                  Manage SSH keys
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<a href={setupHref} />}
                >
                  Open setup
                </Button>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="header-runner-token">Runner token</label>
                <InputGroup>
                  <InputGroupInput
                    id="header-runner-token"
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
                      {token ? "Regenerate token" : "Generate token"}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {tokenQuery.isError ? (
                  <div className="text-xs text-destructive">
                    {tokenQuery.error instanceof Error ? tokenQuery.error.message : String(tokenQuery.error)}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">Runner start command</div>
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

              {runners.length ? (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Recent runners</div>
                  {runners.slice(0, 5).map((runner) => {
                    const fresh = isRunnerFreshOnline(runner)
                    return (
                      <div key={`${runner._id}-${runner.lastSeenAt}`} className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1 text-xs">
                        <code>{String(runner.runnerName || "")}</code>
                        <span className="text-muted-foreground">
                          {String(runner.lastStatus || "offline")} · {fresh ? "fresh" : "stale"} · {new Date(Number(runner.lastSeenAt || 0)).toLocaleTimeString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
