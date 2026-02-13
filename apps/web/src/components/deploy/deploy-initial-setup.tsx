import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircleIcon, SparklesIcon } from "@heroicons/react/24/solid"
import { useMemo, useRef, useState, type ReactNode } from "react"
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
import { deriveEffectiveSetupDesiredState } from "~/lib/setup/desired-state"
import { sealForRunner } from "~/lib/security/sealed-input"
import { gitRepoStatus } from "~/sdk/vcs"
import { lockdownExecute, lockdownStart } from "~/sdk/infra"
import { serverUpdateApplyExecute, serverUpdateApplyStart } from "~/sdk/server"
import {
  buildSetupDraftSectionAad,
  setupDraftCommit,
  setupDraftSaveNonSecret,
  setupDraftSaveSealedSection,
  type SetupDraftConnection,
  type SetupDraftInfrastructure,
  type SetupDraftView,
} from "~/sdk/setup"
import {
  deriveDeployReadiness,
  extractIssueMessage,
  initialFinalizeSteps,
  stepBadgeLabel,
  stepBadgeVariant,
  type FinalizeState,
  type FinalizeStep,
  type FinalizeStepId,
  type FinalizeStepStatus,
} from "~/components/deploy/deploy-setup-model"

type SetupPendingBootstrapSecrets = {
  adminPassword: string
  tailscaleAuthKey: string
  useTailscaleLockdown: boolean
}

function formatShortSha(sha?: string | null): string {
  const value = String(sha || "").trim()
  return value ? value.slice(0, 7) : "none"
}

export function DeployInitialInstallSetup(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  onContinue?: () => void
  headerBadge?: ReactNode
  setupDraft: SetupDraftView | null
  pendingInfrastructureDraft: SetupDraftInfrastructure | null
  pendingConnectionDraft: SetupDraftConnection | null
  pendingBootstrapSecrets: SetupPendingBootstrapSecrets
}) {
  const projectQuery = useProjectBySlug(props.projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, projectId ? {
      projectId,
    } : "skip"),
  })
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, projectId ? { projectId } : "skip"),
  })
  const wiringQuery = useQuery({
    ...convexQuery(
      api.controlPlane.secretWiring.listByProjectHost,
      projectId && props.host
        ? {
            projectId,
            hostName: props.host,
          }
        : "skip",
    ),
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])
  const sealedRunners = useMemo(
    () =>
      (runnersQuery.data ?? [])
        .filter(
          (runner) =>
            runner.lastStatus === "online"
            && runner.capabilities?.supportsSealedInput === true
            && typeof runner.capabilities?.sealedInputPubSpkiB64 === "string"
            && runner.capabilities.sealedInputPubSpkiB64.trim().length > 0
            && typeof runner.capabilities?.sealedInputKeyId === "string"
            && runner.capabilities.sealedInputKeyId.trim().length > 0
            && typeof runner.capabilities?.sealedInputAlg === "string"
            && runner.capabilities.sealedInputAlg.trim().length > 0,
        )
        .toSorted((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0)),
    [runnersQuery.data],
  )

  const hostSummary = useMemo(
    () => (hostsQuery.data ?? []).find((row) => row.hostName === props.host) ?? null,
    [hostsQuery.data, props.host],
  )
  const tailnetMode = String(hostSummary?.desired?.tailnetMode || "none")
  const isTailnet = tailnetMode === "tailscale"
  const desiredSshExposureMode = String(hostSummary?.desired?.sshExposureMode || "").trim()
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
  const desired = useMemo(
    () =>
      deriveEffectiveSetupDesiredState({
        config: setupConfigQuery.data ?? null,
        host: props.host,
        setupDraft: props.setupDraft,
        pendingNonSecretDraft: {
          infrastructure: props.pendingInfrastructureDraft ?? undefined,
          connection: props.pendingConnectionDraft ?? undefined,
        },
      }),
    [
      props.host,
      props.pendingConnectionDraft,
      props.pendingInfrastructureDraft,
      props.setupDraft,
      setupConfigQuery.data,
    ],
  )
  const deployCredsDraftSet = props.setupDraft?.sealedSecretDrafts?.deployCreds?.status === "set"

  const selectedRev = repoStatus.data?.originHead
  const missingRev = !selectedRev
  const needsPush = Boolean(repoStatus.data?.needsPush)
  const readiness = deriveDeployReadiness({
    runnerOnline,
    repoPending: repoStatus.isPending,
    repoError: repoStatus.error,
    missingRev,
    needsPush,
    localSelected: false,
    allowLocalDeploy: false,
  })
  const repoGateBlocked = readiness.blocksDeploy
  const statusReason = readiness.message

  const hasDesiredSshKeys = desired.connection.sshAuthorizedKeys.length > 0
  const sshKeyGateBlocked = runnerOnline && !hasDesiredSshKeys
  const sshKeyGateMessage = !runnerOnline
    ? null
    : !hasDesiredSshKeys
      ? setupConfigQuery.isPending
        ? "Checking desired SSH key state..."
        : setupConfigQuery.isError
          ? "Unable to read config fallback. Open Server Access and retry."
          : "SSH key required before deploy. Add at least one key in Server Access. Setup uses pending/draft values until setup apply."
      : null

  const credsGateBlocked = runnerOnline && !deployCredsDraftSet
  const credsGateMessage = !runnerOnline
    ? null
    : !deployCredsDraftSet
      ? "Missing provider credentials draft. Open Pre-Deploy and save credentials. Setup applies them during setup apply."
      : null

  const deployGateBlocked = repoGateBlocked || sshKeyGateBlocked || credsGateBlocked
  const deployStatusReason = repoGateBlocked
    ? statusReason
    : sshKeyGateMessage || credsGateMessage || statusReason

  const wantsTailscaleLockdown = props.pendingBootstrapSecrets.useTailscaleLockdown
  const hasPendingTailscaleKey = props.pendingBootstrapSecrets.tailscaleAuthKey.trim().length > 0
  const canAutoLockdown = isTailnet && wantsTailscaleLockdown && (hasTailscaleSecret || hasPendingTailscaleKey)

  const [bootstrapRunId, setBootstrapRunId] = useState<Id<"runs"> | null>(null)
  const [setupApplyRunId, setSetupApplyRunId] = useState<Id<"runs"> | null>(null)
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
      } else if (!hasTailscaleSecret && !hasPendingTailscaleKey) {
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
      if (!selectedRev) throw new Error("No pushed revision found.")
      if (!deployCredsDraftSet) {
        throw new Error("Missing provider credentials draft. Open Pre-Deploy and save credentials.")
      }

      const infrastructurePatch: SetupDraftInfrastructure = {
        serverType: desired.infrastructure.serverType,
        image: desired.infrastructure.image,
        location: desired.infrastructure.location,
        allowTailscaleUdpIngress: desired.infrastructure.allowTailscaleUdpIngress,
      }
      const connectionPatch: SetupDraftConnection = {
        adminCidr: desired.connection.adminCidr,
        sshExposureMode: desired.connection.sshExposureMode,
        sshKeyCount: desired.connection.sshKeyCount,
        sshAuthorizedKeys: desired.connection.sshAuthorizedKeys,
      }

      if (!infrastructurePatch.serverType?.trim() || !infrastructurePatch.location?.trim()) {
        throw new Error("Host settings incomplete. Set server type and location.")
      }
      if (!connectionPatch.adminCidr?.trim()) {
        throw new Error("Server access incomplete. Set admin CIDR.")
      }
      if (!connectionPatch.sshAuthorizedKeys?.length) {
        throw new Error("Server access incomplete. Add at least one SSH key.")
      }

      const savedNonSecretDraft = await setupDraftSaveNonSecret({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
          expectedVersion: props.setupDraft?.version,
          patch: {
            infrastructure: infrastructurePatch,
            connection: {
              ...connectionPatch,
              sshKeyCount: connectionPatch.sshAuthorizedKeys.length,
            },
          },
        },
      })

      const preferredRunnerId = savedNonSecretDraft?.sealedSecretDrafts?.deployCreds?.targetRunnerId
        || props.setupDraft?.sealedSecretDrafts?.deployCreds?.targetRunnerId
      const targetRunner = preferredRunnerId
        ? sealedRunners.find((runner) => String(runner._id) === String(preferredRunnerId))
        : sealedRunners.length === 1
          ? sealedRunners[0]
          : null
      if (!targetRunner) {
        throw new Error("Token runner missing. Save deploy credentials first with an online sealed-capable runner.")
      }

      const targetRunnerId = String(targetRunner._id) as Id<"runners">
      const runnerPub = String(targetRunner.capabilities?.sealedInputPubSpkiB64 || "").trim()
      const keyId = String(targetRunner.capabilities?.sealedInputKeyId || "").trim()
      const alg = String(targetRunner.capabilities?.sealedInputAlg || "").trim()
      if (!runnerPub || !keyId || !alg) throw new Error("Runner sealed-input capabilities incomplete")

      const bootstrapSecretsPayload: Record<string, string> = {}
      const adminPassword = props.pendingBootstrapSecrets.adminPassword.trim()
      const tailscaleAuthKey = props.pendingBootstrapSecrets.useTailscaleLockdown
        ? props.pendingBootstrapSecrets.tailscaleAuthKey.trim()
        : ""
      if (adminPassword) bootstrapSecretsPayload.adminPasswordHash = adminPassword
      if (tailscaleAuthKey) bootstrapSecretsPayload.tailscaleAuthKey = tailscaleAuthKey

      const aad = buildSetupDraftSectionAad({
        projectId: projectId as Id<"projects">,
        host: props.host,
        section: "bootstrapSecrets",
        targetRunnerId,
      })
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: runnerPub,
        keyId,
        alg,
        aad,
        plaintextJson: JSON.stringify(bootstrapSecretsPayload),
      })
      await setupDraftSaveSealedSection({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
          section: "bootstrapSecrets",
          targetRunnerId,
          sealedInputB64,
          sealedInputAlg: alg,
          sealedInputKeyId: keyId,
          aad,
          expectedVersion: savedNonSecretDraft?.version,
        },
      })

      await queryClient.invalidateQueries({ queryKey: ["setupDraft", projectId, props.host] })

      const setupApply = await setupDraftCommit({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
        },
      })
      setSetupApplyRunId(setupApply.runId)

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
          lockdownAfter: canAutoLockdown,
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
      headerBadge={props.headerBadge}
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

        {isBootstrapped && desiredSshExposureMode !== "tailnet" ? (
          <Alert variant="destructive">
            <AlertTitle>SSH may still be publicly exposed</AlertTitle>
            <AlertDescription>
              <div>SSH exposure is not set to <code>tailnet</code> (current: <code>{desiredSshExposureMode || "unknown"}</code>).</div>
              <div className="pt-1">Enable tailnet mode and run lockdown to close public SSH access.</div>
            </AlertDescription>
          </Alert>
        ) : !isBootstrapped && !canAutoLockdown && wantsTailscaleLockdown ? (
          <Alert
            variant="default"
            className="border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"
          >
            <AlertTitle>Auto-lockdown disabled</AlertTitle>
            <AlertDescription>
              <div>Deploy can leave SSH (22) open until tailnet mode is enabled and a Tailscale auth key is configured.</div>
              <div className="pt-1">Tailnet mode: <code>{tailnetMode || "unknown"}</code>. Tailscale auth key: <code>{(hasTailscaleSecret || hasPendingTailscaleKey) ? "configured" : "missing"}</code>.</div>
            </AlertDescription>
          </Alert>
        ) : null}

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
              </AlertDescription>
            </Alert>
          ) : null}


          {!isBootstrapped && credsGateMessage && !repoGateBlocked && !sshKeyGateBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>Provider token required</AlertTitle>
              <AlertDescription>
                <div>{credsGateMessage}</div>
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

        {setupApplyRunId ? <RunLogTail runId={setupApplyRunId} /> : null}
        {lockdownRunId ? <RunLogTail runId={lockdownRunId} /> : null}
        {applyRunId ? <RunLogTail runId={applyRunId} /> : null}
      </div>
    </SettingsSection>
  )
}
