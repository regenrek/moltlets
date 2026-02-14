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
import { bootstrapExecute, bootstrapStart, getDeployCredsStatus, lockdownExecute, lockdownStart, runDoctor } from "~/sdk/infra"
import { useProjectBySlug } from "~/lib/project-data"
import { deriveProjectRunnerNixReadiness, isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { deriveEffectiveSetupDesiredState } from "~/lib/setup/desired-state"
import { setupConfigProbeQueryKey, setupConfigProbeQueryOptions } from "~/lib/setup/repo-probe"
import { deriveSshKeyGateUi } from "~/lib/setup/ssh-key-gate"
import { sealForRunner } from "~/lib/security/sealed-input"
import { gitRepoStatus } from "~/sdk/vcs"
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
  hasActiveTailscaleAuthKey: boolean
  activeTailscaleAuthKey: string
  showRunnerStatusBanner?: boolean
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
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])
  const runnerNixReadiness = useMemo(
    () => deriveProjectRunnerNixReadiness(runnersQuery.data ?? []),
    [runnersQuery.data],
  )
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
  const hasProjectTailscaleAuthKey = props.hasActiveTailscaleAuthKey

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
      setupConfigQuery.data,
      props.host,
      props.pendingConnectionDraft,
      props.pendingInfrastructureDraft,
      props.setupDraft,
    ],
  )

  const deployCredsStatusQuery = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () =>
      await getDeployCredsStatus({ data: { projectId: projectId as Id<"projects"> } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(projectId && runnerOnline),
  })
  const projectDeployCredsByKey = useMemo(() => {
    const out: Record<string, { status?: "set" | "unset"; value?: string }> = {}
    for (const row of deployCredsStatusQuery.data?.keys || []) out[row.key] = row
    return out
  }, [deployCredsStatusQuery.data?.keys])

  const deployCredsDraftSet = props.setupDraft?.sealedSecretDrafts?.deployCreds?.status === "set"
  const projectGithubTokenSet = projectDeployCredsByKey["GITHUB_TOKEN"]?.status === "set"
  const projectSopsAgeKeyPath = String(projectDeployCredsByKey["SOPS_AGE_KEY_FILE"]?.value || "").trim()
  const effectiveDeployCredsReady = (deployCredsDraftSet || projectGithubTokenSet) && projectSopsAgeKeyPath.length > 0

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
  const nixGateBlocked = runnerOnline && !runnerNixReadiness.ready
  const nixGateMessage = !runnerOnline
    ? null
    : runnerNixReadiness.ready
      ? null
      : "Runner is online but Nix is missing. Install Nix on the runner host, then restart the runner."
  const sshKeyGateUi = deriveSshKeyGateUi({
    runnerOnline,
    hasDesiredSshKeys,
    probePending: setupConfigQuery.isPending,
    probeError: setupConfigQuery.isError,
  })
  const sshKeyGateBlocked = sshKeyGateUi.blocked
  const sshKeyGateMessage = sshKeyGateUi.message

  const deployCredsStatusError = runnerOnline ? deployCredsStatusQuery.error : null
  const credsGateBlocked = runnerOnline && (Boolean(deployCredsStatusError) || !effectiveDeployCredsReady)
  const credsGateMessage = !runnerOnline
    ? null
    : deployCredsStatusError
      ? `Could not read deploy credentials: ${String(deployCredsStatusError)}`
      : !effectiveDeployCredsReady
        ? "Missing credentials. Add GitHub token in Pre-Deploy and SOPS path in Server access."
      : null

  const deployGateBlocked = repoGateBlocked || nixGateBlocked || sshKeyGateBlocked || credsGateBlocked
  const deployStatusReason = repoGateBlocked
    ? statusReason
    : nixGateMessage || sshKeyGateMessage || credsGateMessage || statusReason

  const wantsTailscaleLockdown = props.pendingBootstrapSecrets.useTailscaleLockdown
  const hasPendingTailscaleKey = props.pendingBootstrapSecrets.tailscaleAuthKey.trim().length > 0
  const canAutoLockdown = isTailnet && wantsTailscaleLockdown && (hasProjectTailscaleAuthKey || hasPendingTailscaleKey)

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
      } else if (!hasProjectTailscaleAuthKey && !hasPendingTailscaleKey) {
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
        queryKey: ["gitRepoStatus", projectId],
      })
      void queryClient.invalidateQueries({
        queryKey: setupConfigProbeQueryKey(projectId),
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
      if (!effectiveDeployCredsReady) {
        throw new Error("Missing credentials. Set GitHub token in Pre-Deploy and SOPS path in Server access.")
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
        : sealedRunners[0] ?? null
      if (!targetRunner) {
        throw new Error("No sealed-capable runner online. Start runner and retry.")
      }

      const targetRunnerId = String(targetRunner._id) as Id<"runners">
      const runnerPub = String(targetRunner.capabilities?.sealedInputPubSpkiB64 || "").trim()
      const keyId = String(targetRunner.capabilities?.sealedInputKeyId || "").trim()
      const alg = String(targetRunner.capabilities?.sealedInputAlg || "").trim()
      if (!runnerPub || !keyId || !alg) throw new Error("Runner sealed-input capabilities incomplete")

      const deployCredsDraftAlreadySet = savedNonSecretDraft?.sealedSecretDrafts?.deployCreds?.status === "set"
        || props.setupDraft?.sealedSecretDrafts?.deployCreds?.status === "set"
      let currentDraftVersion = savedNonSecretDraft?.version
      if (!deployCredsDraftAlreadySet) {
        const deployCredsPayload: Record<string, string> = {}
        if (projectSopsAgeKeyPath) deployCredsPayload.SOPS_AGE_KEY_FILE = projectSopsAgeKeyPath

        if (Object.keys(deployCredsPayload).length === 0) {
          throw new Error("Could not auto-seal deploy credentials for setup. Open Pre-Deploy and save credentials.")
        }

        const deployCredsAad = buildSetupDraftSectionAad({
          projectId: projectId as Id<"projects">,
          host: props.host,
          section: "deployCreds",
          targetRunnerId,
        })
        const deployCredsSealedInputB64 = await sealForRunner({
          runnerPubSpkiB64: runnerPub,
          keyId,
          alg,
          aad: deployCredsAad,
          plaintextJson: JSON.stringify(deployCredsPayload),
        })
        const savedDeployCredsDraft = await setupDraftSaveSealedSection({
          data: {
            projectId: projectId as Id<"projects">,
            host: props.host,
            section: "deployCreds",
            targetRunnerId,
            sealedInputB64: deployCredsSealedInputB64,
            sealedInputAlg: alg,
            sealedInputKeyId: keyId,
            aad: deployCredsAad,
            expectedVersion: currentDraftVersion,
          },
        })
        currentDraftVersion = savedDeployCredsDraft.version
      }

      const bootstrapSecretsPayload: Record<string, string> = {}
      const adminPassword = props.pendingBootstrapSecrets.adminPassword.trim()
      const tailscaleAuthKey = props.pendingBootstrapSecrets.useTailscaleLockdown
        ? (props.pendingBootstrapSecrets.tailscaleAuthKey.trim() || props.activeTailscaleAuthKey.trim())
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
          expectedVersion: currentDraftVersion,
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
        {props.showRunnerStatusBanner !== false ? (
          <RunnerStatusBanner
            projectId={projectId as Id<"projects">}
            setupHref={`/${props.projectSlug}/hosts/${props.host}/setup`}
            runnerOnline={runnerOnline}
            isChecking={runnersQuery.isPending}
          />
        ) : null}

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
              <div className="pt-1">Tailnet mode: <code>{tailnetMode || "unknown"}</code>. Tailscale auth key: <code>{(hasProjectTailscaleAuthKey || hasPendingTailscaleKey) ? "configured" : "missing"}</code>.</div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          {!isBootstrapped && nixGateMessage && !repoGateBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>Nix missing on runner</AlertTitle>
              <AlertDescription>
                <div>{nixGateMessage}</div>
                <div className="pt-1">
                  Install command: <code>curl -fsSL https://install.determinate.systems/nix | sh -s -- install --no-confirm</code>
                </div>
                <div className="pt-1">
                  Runner: <code>{runnerNixReadiness.runnerName || "unknown"}</code>.
                  {runnerNixReadiness.nixBin ? <> NIX_BIN: <code>{runnerNixReadiness.nixBin}</code>.</> : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {!isBootstrapped && sshKeyGateMessage && !repoGateBlocked && !nixGateBlocked ? (
            <Alert
              variant={sshKeyGateUi.variant}
            >
              <AlertTitle>
                {sshKeyGateUi.title || "SSH key required"}
              </AlertTitle>
              <AlertDescription>
                <div>{sshKeyGateMessage}</div>
              </AlertDescription>
            </Alert>
          ) : null}


          {!isBootstrapped && credsGateMessage && !repoGateBlocked && !nixGateBlocked && !sshKeyGateBlocked ? (
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
