import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CheckCircleIcon, SparklesIcon } from "@heroicons/react/24/solid"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { SettingsSection } from "~/components/ui/settings-section"
import { Spinner } from "~/components/ui/spinner"
import { configDotSet } from "~/sdk/config"
import { getHostPublicIpv4, probeHostTailscaleIpv4 } from "~/sdk/host"
import { bootstrapExecute, bootstrapStart, runDoctor } from "~/sdk/infra"
import { useProjectBySlug } from "~/lib/project-data"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { setupConfigProbeQueryKey, setupConfigProbeQueryOptions } from "~/lib/setup/repo-probe"
import { deriveDeploySshKeyReadiness } from "~/lib/setup/deploy-ssh-key-readiness"
import { gitRepoStatus } from "~/sdk/vcs"
import { lockdownExecute, lockdownStart } from "~/sdk/infra"
import { serverUpdateApplyExecute, serverUpdateApplyStart } from "~/sdk/server"
import {
  deriveDeployReadiness,
  deriveFirstPushGuidance,
  extractIssueMessage,
  initialFinalizeSteps,
  stepBadgeLabel,
  stepBadgeVariant,
  type FinalizeState,
  type FinalizeStep,
  type FinalizeStepId,
  type FinalizeStepStatus,
} from "~/components/deploy/deploy-setup-model"

function formatShortSha(sha?: string | null): string {
  const value = String(sha || "").trim()
  return value ? value.slice(0, 7) : "none"
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

export function DeployInitialInstallSetup(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  onContinue?: () => void
}) {
  const projectQuery = useProjectBySlug(props.projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, {
      projectId: projectId as Id<"projects">,
    }),
    enabled: Boolean(projectId),
  })
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
    enabled: Boolean(projectId),
  })
  const wiringQuery = useQuery({
    ...convexQuery(api.controlPlane.secretWiring.listByProjectHost, {
      projectId: projectId as Id<"projects">,
      hostName: props.host,
    }),
    enabled: Boolean(projectId && props.host),
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])
  const hostSummary = useMemo(
    () => (hostsQuery.data ?? []).find((row) => row.hostName === props.host) ?? null,
    [hostsQuery.data, props.host],
  )
  const tailnetMode = String(hostSummary?.desired?.tailnetMode || "none")
  const isTailnet = tailnetMode === "tailscale"
  const configuredSecrets = useMemo(() => {
    const names = new Set<string>()
    for (const row of wiringQuery.data ?? []) {
      if (row?.status === "configured") names.add(String(row.secretName || ""))
    }
    return names
  }, [wiringQuery.data])
  const hasTailscaleSecret = configuredSecrets.has("tailscale_auth_key")

  const repoStatus = useQuery({
    queryKey: ["gitRepoStatus", projectId],
    queryFn: async () =>
      await gitRepoStatus({ data: { projectId: projectId as Id<"projects"> } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(projectId && runnerOnline),
  })
  const setupConfigQuery = useQuery({
    ...setupConfigProbeQueryOptions(projectId),
    enabled: Boolean(projectId && runnerOnline),
  })

  const selectedRev = repoStatus.data?.originHead
  const missingRev = !selectedRev
  const readiness = deriveDeployReadiness({
    runnerOnline,
    repoPending: repoStatus.isPending,
    repoError: repoStatus.error,
    missingRev,
    needsPush: false,
    localSelected: false,
    allowLocalDeploy: false,
  })
  const repoGateBlocked = readiness.blocksDeploy
  const statusReason = readiness.message
  const firstPushGuidance = deriveFirstPushGuidance({ upstream: repoStatus.data?.upstream })
  const sshKeyReadiness = deriveDeploySshKeyReadiness({
    fleetSshAuthorizedKeys: setupConfigQuery.data?.fleet?.sshAuthorizedKeys,
  })
  const sshKeyGateBlocked = runnerOnline && (
    setupConfigQuery.isPending
    || setupConfigQuery.isError
    || !sshKeyReadiness.ready
  )
  const sshKeyGateMessage = !runnerOnline
    ? null
    : setupConfigQuery.isPending
      ? "Checking SSH key source..."
      : setupConfigQuery.isError
        ? "Unable to read SSH key settings. Open Server Access and retry."
        : sshKeyReadiness.ready
          ? null
          : "SSH key required before deploy. Add at least one fleet SSH key in Server Access."
  const deployGateBlocked = repoGateBlocked || sshKeyGateBlocked
  const deployStatusReason = repoGateBlocked ? statusReason : (sshKeyGateMessage || statusReason)

  const [bootstrapRunId, setBootstrapRunId] = useState<Id<"runs"> | null>(null)
  const [bootstrapStatus, setBootstrapStatus] = useState<"idle" | "running" | "succeeded" | "failed">("idle")
  const [finalizeState, setFinalizeState] = useState<FinalizeState>("idle")
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [finalizeSteps, setFinalizeSteps] = useState<FinalizeStep[]>(() => initialFinalizeSteps())
  const [lockdownRunId, setLockdownRunId] = useState<Id<"runs"> | null>(null)
  const [applyRunId, setApplyRunId] = useState<Id<"runs"> | null>(null)
  const finalizeStartedRef = useRef(false)

  function setStepStatus(id: FinalizeStepId, status: FinalizeStepStatus, detail?: string): void {
    setFinalizeSteps((prev) => prev.map((row) => (
      row.id === id ? { ...row, status, detail } : row
    )))
  }

  async function runFinalizeStep(params: {
    id: FinalizeStepId
    run: () => Promise<string | undefined>
    onError?: (message: string) => void
  }): Promise<void> {
    setStepStatus(params.id, "running")
    try {
      const detail = await params.run()
      setStepStatus(params.id, "succeeded", detail)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStepStatus(params.id, "failed", message)
      params.onError?.(message)
      throw error
    }
  }

  const startFinalize = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      setFinalizeState("running")
      setFinalizeError(null)
      setFinalizeSteps(initialFinalizeSteps())

      let targetHost = String(hostSummary?.desired?.targetHost || "").trim()
      await runFinalizeStep({
        id: "enableHost",
        run: async () => {
          const result = await configDotSet({
            data: {
              projectId: projectId as Id<"projects">,
              path: `hosts.${props.host}.enable`,
              valueJson: "true",
            },
          })
          if (!result.ok) throw new Error(extractIssueMessage(result, "Could not enable host"))
          return "Enabled"
        },
      })

      if (targetHost) {
        setStepStatus("setTargetHost", "skipped", `Already set: ${targetHost}`)
      } else {
        await runFinalizeStep({
          id: "setTargetHost",
          run: async () => {
            const ipv4 = await getHostPublicIpv4({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
              },
            })
            if (!ipv4.ok) throw new Error(ipv4.error || "Could not find public IPv4")
            if (!ipv4.ipv4) throw new Error("Could not find public IPv4")
            targetHost = `admin@${ipv4.ipv4}`
            const result = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.targetHost`,
                value: targetHost,
              },
            })
            if (!result.ok) throw new Error(extractIssueMessage(result, "Could not set target host"))
            return targetHost
          },
        })
      }

      if (!isTailnet) {
        setStepStatus("switchTailnetTarget", "skipped", "Tailnet mode disabled")
        setStepStatus("switchSshExposure", "skipped", "Tailnet mode disabled")
        setStepStatus("lockdown", "skipped", "Tailnet mode disabled")
      } else if (!hasTailscaleSecret) {
        setStepStatus("switchTailnetTarget", "skipped", "Tailscale auth key missing")
        setStepStatus("switchSshExposure", "skipped", "Tailscale auth key missing")
        setStepStatus("lockdown", "skipped", "Tailscale auth key missing")
      } else {
        await runFinalizeStep({
          id: "switchTailnetTarget",
          run: async () => {
            if (!targetHost.trim()) throw new Error("targetHost missing")
            const probe = await probeHostTailscaleIpv4({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
                targetHost,
              },
            })
            if (!probe.ok) throw new Error(probe.error || "Could not resolve tailnet IPv4")
            if (!probe.ipv4) throw new Error("Could not resolve tailnet IPv4")
            targetHost = `admin@${probe.ipv4}`
            const result = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.targetHost`,
                value: targetHost,
              },
            })
            if (!result.ok) throw new Error(extractIssueMessage(result, "Could not set tailnet targetHost"))
            return targetHost
          },
        })

        await runFinalizeStep({
          id: "switchSshExposure",
          run: async () => {
            const result = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.sshExposure.mode`,
                value: "tailnet",
              },
            })
            if (!result.ok) throw new Error(extractIssueMessage(result, "Could not switch SSH exposure"))
            return "tailnet"
          },
        })

        await runFinalizeStep({
          id: "lockdown",
          run: async () => {
            const start = await lockdownStart({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
              },
            })
            setLockdownRunId(start.runId)
            await lockdownExecute({
              data: {
                projectId: projectId as Id<"projects">,
                runId: start.runId,
                host: props.host,
              },
            })
            return "Queued"
          },
        })
      }

      await runFinalizeStep({
        id: "applyUpdates",
        run: async () => {
          const start = await serverUpdateApplyStart({
            data: {
              projectId: projectId as Id<"projects">,
              host: props.host,
            },
          })
          setApplyRunId(start.runId)
          await serverUpdateApplyExecute({
            data: {
              projectId: projectId as Id<"projects">,
              runId: start.runId,
              host: props.host,
              targetHost,
              confirm: `apply updates ${props.host}`,
            },
          })
          return targetHost ? `Queued (${targetHost})` : "Queued"
        },
      })

      return true
    },
    onSuccess: () => {
      setFinalizeState("succeeded")
      toast.success("Server hardening queued")
      void queryClient.invalidateQueries({
        queryKey: setupConfigProbeQueryKey(projectId),
      })
      void queryClient.invalidateQueries({
        queryKey: ["gitRepoStatus", projectId],
      })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setFinalizeState("failed")
      setFinalizeError(message)
      toast.error(message)
    },
  })

  const startDeploy = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      if (!selectedRev) {
        throw new Error("No pushed revision found.")
      }
      await runDoctor({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
          scope: "bootstrap",
        },
      })
      const started = await bootstrapStart({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
          mode: "nixos-anywhere",
        },
      })
      setBootstrapRunId(started.runId)
      setBootstrapStatus("running")
      await bootstrapExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: started.runId,
          host: props.host,
          mode: "nixos-anywhere",
          force: false,
          dryRun: false,
          lockdownAfter: true,
          rev: selectedRev,
        },
      })
      return started
    },
    onSuccess: () => {
      toast.info("Deploy started")
    },
    onError: (error) => {
      setBootstrapStatus("failed")
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  const isBootstrapped = props.hasBootstrapped || bootstrapStatus === "succeeded"
  const canStartDeploy = !isBootstrapped
    && !startDeploy.isPending
    && !deployGateBlocked
    && runnerOnline
    && Boolean(projectId)
  const cardStatus = !isBootstrapped
    ? deployStatusReason
    : finalizeState === "running"
      ? "Auto-hardening running..."
      : finalizeState === "failed"
        ? finalizeError || "Automatic hardening failed."
        : "Server deployed. Continue setup."

  const showSuccessBanner = isBootstrapped && (finalizeState === "succeeded" || finalizeState === "idle")
  const successMessage = finalizeState === "succeeded"
    ? "Initial install succeeded and post-bootstrap hardening was queued automatically."
    : bootstrapStatus === "succeeded"
      ? "Initial install succeeded."
      : "Server already deployed for this host."

  return (
    <SettingsSection
      title="Install server"
      description="Deploy this host with safe defaults. Advanced controls stay on the full deploy page."
      statusText={cardStatus}
      actions={!isBootstrapped ? (
        <AsyncButton
          type="button"
          disabled={!canStartDeploy}
          pending={startDeploy.isPending}
          pendingText="Deploying..."
          onClick={() => startDeploy.mutate()}
        >
          Deploy server
        </AsyncButton>
      ) : finalizeState === "running" ? (
        <AsyncButton type="button" disabled pending pendingText="Finishing...">
          Finalizing
        </AsyncButton>
      ) : (
        <Button type="button" onClick={props.onContinue}>
          Continue
        </Button>
      )}
    >
      <div className="space-y-4">
        <RunnerStatusBanner
          projectId={projectId as Id<"projects">}
          setupHref={`/${props.projectSlug}/hosts/${props.host}/setup`}
          runnerOnline={runnerOnline}
          isChecking={runnersQuery.isPending}
        />

        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          Host: <code>{props.host}</code>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Git readiness</div>
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">Remote deploy (default branch)</div>
              <AsyncButton
                type="button"
                size="sm"
                variant="outline"
                disabled={!runnerOnline || repoStatus.isFetching}
                pending={repoStatus.isFetching}
                pendingText="Refreshing..."
                onClick={() => {
                  if (!runnerOnline) return
                  void repoStatus.refetch()
                }}
              >
                Refresh
              </AsyncButton>
            </div>
            {repoStatus.isPending ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3" />
                Checking repo state...
              </div>
              ) : (
              <>
                <div className="space-y-1 text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Revision to deploy</span>
                    <code>{formatShortSha(selectedRev)}</code>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Branch</span>
                    <span>{repoStatus.data?.branch || "unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Upstream</span>
                    <span>{repoStatus.data?.upstream || "unset"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">ahead {repoStatus.data?.ahead ?? 0}</Badge>
                  <Badge variant="outline">behind {repoStatus.data?.behind ?? 0}</Badge>
                </div>
              </>
            )}
          </div>

          {!isBootstrapped && sshKeyGateMessage && !repoGateBlocked ? (
            <Alert
              variant={setupConfigQuery.isPending ? "default" : "destructive"}
              className={setupConfigQuery.isPending
                ? "border-sky-300/50 bg-sky-50/50 text-sky-900 [&_[data-slot=alert-description]]:text-sky-900/90"
                : undefined}
            >
              <AlertTitle>
                {setupConfigQuery.isPending
                  ? "Checking SSH key source"
                  : setupConfigQuery.isError
                    ? "SSH key settings unavailable"
                    : "SSH key required"}
              </AlertTitle>
              <AlertDescription>
                <div>{sshKeyGateMessage}</div>
                {!setupConfigQuery.isPending ? (
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <Link
                      className="underline underline-offset-4 hover:text-foreground"
                      to="/$projectSlug/hosts/$host/setup"
                      params={{ projectSlug: props.projectSlug, host: props.host }}
                      search={{ step: "connection" }}
                    >
                      Open Server Access
                    </Link>
                    <span aria-hidden="true">·</span>
                    <Link
                      className="underline underline-offset-4 hover:text-foreground"
                      to="/$projectSlug/security/ssh-keys"
                      params={{ projectSlug: props.projectSlug }}
                    >
                      Open SSH keys
                    </Link>
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {!isBootstrapped && readiness.reason !== "ready" && readiness.reason !== "repo_pending" ? (
            <Alert
              variant={readiness.severity === "error" ? "destructive" : "default"}
              className={readiness.severity === "warning"
                ? "border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"
                : undefined}
            >
              <AlertTitle>{readiness.title || "Deploy blocked"}</AlertTitle>
              <AlertDescription>
                {readiness.detail || readiness.message}
                {readiness.reason === "repo_error" && repoStatus.error ? (
                  <div className="mt-1 font-mono text-xs">{String(repoStatus.error)}</div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {!isBootstrapped && readiness.showFirstPushGuidance ? (
            <div className="rounded-md border bg-background p-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">First push help</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyText("Git commands", firstPushGuidance.commands)}
                >
                  Copy commands
                </Button>
              </div>
              <div className="text-muted-foreground">
                {firstPushGuidance.hasUpstream
                  ? `Upstream detected (${repoStatus.data?.upstream}). Push once, then refresh.`
                  : "No upstream detected. Set or update origin, push once, then refresh."}
              </div>
              <pre className="rounded-md border bg-muted/30 p-2 whitespace-pre-wrap break-words">
                {firstPushGuidance.commands}
              </pre>
              <div className="text-muted-foreground">{firstPushGuidance.note}</div>
            </div>
          ) : null}
        </div>

        {showSuccessBanner ? (
          <div className="relative overflow-hidden rounded-md border border-emerald-300/50 bg-emerald-50/60 p-3">
            <span className="absolute -top-3 -right-3 size-14 rounded-full bg-emerald-300/30 motion-safe:animate-ping motion-reduce:animate-none" />
            <div className="relative flex items-start gap-2">
              <CheckCircleIcon className="mt-0.5 size-5 text-emerald-700" />
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm font-medium text-emerald-900">
                  <SparklesIcon className="size-4 text-emerald-700" />
                  Server deployed
                </div>
                <div className="text-xs text-emerald-900/90">
                  {successMessage}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {finalizeState !== "idle" ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="text-sm font-medium">Post-bootstrap automation</div>
            <div className="space-y-1.5">
              {finalizeSteps.map((step) => (
                <div key={step.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-2 py-1.5">
                  <div className="min-w-0 text-xs">
                    <div className="font-medium">{step.label}</div>
                    {step.detail ? <div className="truncate text-muted-foreground">{step.detail}</div> : null}
                  </div>
                  <Badge variant={stepBadgeVariant(step.status)} className="shrink-0">
                    {step.status === "running" ? <Spinner className="mr-1 size-3" /> : null}
                    {stepBadgeLabel(step.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {bootstrapRunId ? (
          <RunLogTail
            runId={bootstrapRunId}
            onDone={(status) => {
              if (status === "succeeded") {
                setBootstrapStatus("succeeded")
                if (!finalizeStartedRef.current) {
                  finalizeStartedRef.current = true
                  startFinalize.mutate()
                }
              } else if (status === "failed" || status === "canceled") {
                setBootstrapStatus("failed")
              }
            }}
          />
        ) : null}

        {lockdownRunId ? <RunLogTail runId={lockdownRunId} /> : null}
        {applyRunId ? <RunLogTail runId={applyRunId} /> : null}

        <div className="text-xs text-muted-foreground">
          {finalizeState === "failed" ? "Need manual fixes?" : "Need advanced deploy controls?"}
          {" "}
          <Link
            className="underline underline-offset-4 hover:text-foreground"
            to="/$projectSlug/hosts/$host/deploy"
            params={{ projectSlug: props.projectSlug, host: props.host }}
          >
            Open full deploy page
          </Link>
          .
        </div>
      </div>
    </SettingsSection>
  )
}
