import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CheckCircleIcon, SparklesIcon } from "@heroicons/react/24/solid"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { SetupCelebration } from "~/components/setup/setup-celebration"
import { RunLogTail } from "~/components/run-log-tail"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { SettingsSection } from "~/components/ui/settings-section"
import { Spinner } from "~/components/ui/spinner"
import { configDotSet } from "~/sdk/config"
import { getHostInfraStatus, getHostPublicIpv4, probeHostTailscaleIpv4, probeSshReachability } from "~/sdk/host"
import {
  bootstrapExecute,
  bootstrapStart,
  generateSopsAgeKey,
  lockdownExecute,
  lockdownStart,
  queueDeployCredsUpdate,
  runDoctor,
} from "~/sdk/infra"
import { useProjectBySlug } from "~/lib/project-data"
import { deriveProjectRunnerNixReadiness, isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { deriveEffectiveSetupDesiredState } from "~/lib/setup/desired-state"
import { setupConfigProbeQueryKey, setupConfigProbeQueryOptions } from "~/lib/setup/repo-probe"
import { deriveSshKeyGateUi } from "~/lib/setup/ssh-key-gate"
import { sealForRunner } from "~/lib/security/sealed-input"
import { gitRepoStatus, gitSetupSaveExecute } from "~/domains/vcs"
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
  useTailscaleLockdown: boolean
}

type PredeployCheckId =
  | "runner"
  | "repo"
  | "ssh"
  | "adminPassword"
  | "projectCreds"
  | "requiredHostSecrets"
  | "sealedDrafts"
  | "setupApply"
  | "saveToGit"

type PredeployCheckState = "pending" | "passed" | "failed"
type PredeployState = "idle" | "running" | "failed" | "ready"

type PredeployCheck = {
  id: PredeployCheckId
  label: string
  state: PredeployCheckState
  detail?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function initialPredeployChecks(): PredeployCheck[] {
  return [
    { id: "runner", label: "Runner ready", state: "pending" },
    { id: "repo", label: "Repo ready", state: "pending" },
    { id: "ssh", label: "SSH setup ready", state: "pending" },
    { id: "adminPassword", label: "Admin password ready", state: "pending" },
    { id: "projectCreds", label: "Project creds ready", state: "pending" },
    { id: "requiredHostSecrets", label: "Required host secrets", state: "pending" },
    { id: "sealedDrafts", label: "Host secrets written", state: "pending" },
    { id: "setupApply", label: "Setup apply", state: "pending" },
    { id: "saveToGit", label: "Saved to Git", state: "pending" },
  ]
}

export function DeployInitialInstallSetup(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  headerBadge?: ReactNode
  setupDraft: SetupDraftView | null
  pendingInfrastructureDraft: SetupDraftInfrastructure | null
  pendingConnectionDraft: SetupDraftConnection | null
  pendingBootstrapSecrets: SetupPendingBootstrapSecrets
  hasProjectGithubToken: boolean
  hasProjectGithubTokenAccess: boolean
  githubTokenAccessMessage: string
  hasProjectGitRemoteOrigin: boolean
  projectGitRemoteOrigin: string
  hasHostTailscaleAuthKey: boolean
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

  ;
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, projectId ? { projectId } : "skip"),
  })

  ;
  const latestBootstrapRunQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runs.latestByProjectHostKind,
      projectId && props.host
        ? {
            projectId,
            host: props.host,
            kind: "bootstrap",
          }
        : "skip",
    ),
    enabled: Boolean(projectId && props.host),
  })

  ;
  const latestLockdownRunQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runs.latestByProjectHostKind,
      projectId && props.host
        ? {
            projectId,
            host: props.host,
            kind: "lockdown",
          }
        : "skip",
    ),
    enabled: Boolean(projectId && props.host),
  })
  const latestApplyRunQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runs.latestByProjectHostKind,
      projectId && props.host
        ? {
            projectId,
            host: props.host,
            kind: "server_update_apply",
          }
        : "skip",
    ),
    enabled: Boolean(projectId && props.host),
  })
  const secretWiringQuery = useQuery({
    ...convexQuery(
      api.controlPlane.secretWiring.listByProjectHost,
      projectId ? { projectId, hostName: props.host } : "skip",
    ),
    enabled: Boolean(projectId && props.host),
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
  const infraStatusQuery = useQuery({
    queryKey: ["hostInfraStatus", projectId, props.host],
    queryFn: async () => {
      if (!projectId) throw new Error("missing projectId")
      return await getHostInfraStatus({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
        },
      })
    },
    enabled: Boolean(projectId && runnerOnline && props.host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
  })
  const infraExists = infraStatusQuery.data?.ok ? infraStatusQuery.data.exists : undefined
  const infraMissing = infraExists === false
  const infraMissingDetail = infraMissing && infraStatusQuery.data?.ok && typeof infraStatusQuery.data.detail === "string"
    ? infraStatusQuery.data.detail.trim()
    : ""
  const tailnetMode = String(hostSummary?.desired?.tailnetMode || "none")
  const isTailnet = tailnetMode === "tailscale"
  const desiredSshExposureMode = String(hostSummary?.desired?.sshExposureMode || "").trim()
  const tailscaleAuthKeyConfigured = useMemo(
    () =>
      (secretWiringQuery.data ?? []).some(
        (row) => row.secretName === "tailscale_auth_key" && row.status === "configured",
      ),
    [secretWiringQuery.data],
  )
  const adminPasswordConfigured = useMemo(
    () =>
      (secretWiringQuery.data ?? []).some(
        (row) => row.secretName === "admin_password_hash" && row.status === "configured",
      ),
    [secretWiringQuery.data],
  )
  const adminPasswordRequired = !adminPasswordConfigured
  const adminPassword = props.pendingBootstrapSecrets.adminPassword.trim()
  const adminPasswordGateBlocked = adminPasswordRequired && !adminPassword
  const adminPasswordGateMessage = adminPasswordGateBlocked
    ? "Server access incomplete. Set admin password."
    : null
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

  const projectGithubTokenSet = props.hasProjectGithubToken
  const projectGithubTokenAccessSet = props.hasProjectGithubTokenAccess
  const githubTokenAccessMessage = props.githubTokenAccessMessage?.trim()
  const githubTokenAccessText = githubTokenAccessMessage.length > 0 ? githubTokenAccessMessage : null
  const projectGitRemoteOriginSet = props.hasProjectGitRemoteOrigin
  const projectGitRemoteOriginFromValue = Boolean(props.projectGitRemoteOrigin.trim())
  const projectGitRemoteOriginReady = projectGitRemoteOriginSet || projectGitRemoteOriginFromValue

  const wantsTailscaleLockdown = props.pendingBootstrapSecrets.useTailscaleLockdown
  const requiresTailscaleAuthKey = wantsTailscaleLockdown || isTailnet || desired.connection.sshExposureMode === "tailnet"
  const requiredHostSecretsConfigured = !requiresTailscaleAuthKey || tailscaleAuthKeyConfigured
  const requiredHostSecretsGateBlocked = runnerOnline && !requiredHostSecretsConfigured
  const requiredHostSecretsGateMessage = runnerOnline && requiresTailscaleAuthKey
    && !requiredHostSecretsConfigured
    ? "Missing tailscale_auth_key. Configure it in Tailscale lockdown (per host)."
    : null

  const [preparedRev, setPreparedRev] = useState<string | null>(null)

  const selectedRev = preparedRev ?? repoStatus.data?.originHead
  const missingRev = !selectedRev
  const needsPush = Boolean(repoStatus.data?.needsPush)
  const dirtyRepo = Boolean(repoStatus.data?.dirty)
  const readiness = deriveDeployReadiness({
    runnerOnline,
    repoPending: repoStatus.isPending,
    repoError: repoStatus.error,
    dirty: dirtyRepo,
    missingRev,
    needsPush,
    localSelected: false,
    allowLocalDeploy: false,
  })
  const repoGateBlocked = readiness.blocksDeploy
  const statusReason = readiness.message
  const showRepoSaveToGitButton = readiness.reason === "dirty_repo" || readiness.reason === "needs_push"
  const repoSaveManualCommand = readiness.reason === "needs_push"
    ? "git push"
    : "git add .\ngit commit -m \"Prepare deploy\"\ngit push"

  const runPredeployAfterSave = () => {
    runPredeploy.mutate()
  }

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

  const credsGateBlocked =
    runnerOnline &&
    (!props.hasProjectGithubToken || !projectGitRemoteOriginReady || !projectGithubTokenAccessSet)
  const credsGateMessage = !runnerOnline
    ? null
    : !projectGithubTokenSet
      ? "Missing GitHub Deploy Token. Add it in Git Configuration."
      : !projectGitRemoteOriginReady
        ? "Missing git remote origin. Add it in Git Configuration."
        : !projectGithubTokenAccessSet
          ? `GitHub Deploy Token lacks repository access. ${githubTokenAccessText || "Use a token with repo scope."}`
          : null
  const projectCredsFailureDetail = credsGateBlocked
    ? credsGateMessage || "Project credentials missing"
    : "Project credentials ready"
  const projectCredsPassedDetail = `Deploy token and git remote configured${projectGithubTokenAccessSet ? "" : "; token access check failed"}`
  const deployCredsGateAlertTitle = projectGithubTokenSet && !projectGithubTokenAccessSet && runnerOnline
    ? "GitHub deploy token denied"
    : "Provider token required"

  const deployGateBlocked =
    repoGateBlocked || nixGateBlocked || sshKeyGateBlocked || adminPasswordGateBlocked
    || credsGateBlocked || requiredHostSecretsGateBlocked
  const deployStatusReason = repoGateBlocked
    ? statusReason
    : nixGateMessage || sshKeyGateMessage || adminPasswordGateMessage
      || requiredHostSecretsGateMessage || credsGateMessage || statusReason

  const canAutoLockdown = wantsTailscaleLockdown && tailscaleAuthKeyConfigured
  const adminCidr = String(desired.connection.adminCidr || "").trim()
  const adminCidrWorldOpen = adminCidr === "0.0.0.0/0" || adminCidr === "::/0"
  const autoLockdownMissingTailscaleKey = !tailscaleAuthKeyConfigured
  const latestBootstrapRun = latestBootstrapRunQuery.data ?? null
  const latestBootstrapRunId = latestBootstrapRun?._id as Id<"runs"> | null
  const latestBootstrapRunStatus = String(latestBootstrapRun?.status || "").trim()
  const latestBootstrapRunning = latestBootstrapRunStatus === "queued" || latestBootstrapRunStatus === "running"
  const latestBootstrapSucceeded = latestBootstrapRunStatus === "succeeded"
  const latestBootstrapFailed = latestBootstrapRunStatus === "failed" || latestBootstrapRunStatus === "canceled"

  const [bootstrapRunId, setBootstrapRunId] = useState<Id<"runs"> | null>(null)
  const [setupApplyRunId, setSetupApplyRunId] = useState<Id<"runs"> | null>(null)
  const [bootstrapStatus, setBootstrapStatus] = useState<"idle" | "running" | "succeeded" | "failed">("idle")
  const [bootstrapFinalizeArmed, setBootstrapFinalizeArmed] = useState(false)
  const [predeployState, setPredeployState] = useState<PredeployState>("idle")
  const [predeployChecks, setPredeployChecks] = useState<PredeployCheck[]>(() => initialPredeployChecks())
  const [predeployError, setPredeployError] = useState<string | null>(null)
  const [predeployReadyFingerprint, setPredeployReadyFingerprint] = useState<string | null>(null)
  const [predeployUpdatedAt, setPredeployUpdatedAt] = useState<number | null>(null)
  const [finalizeState, setFinalizeState] = useState<FinalizeState>("idle")
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [finalizeSteps, setFinalizeSteps] = useState<FinalizeStep[]>(() => initialFinalizeSteps())
  const [finalizeUpdatedAt, setFinalizeUpdatedAt] = useState<number | null>(null)
  const [lockdownRunId, setLockdownRunId] = useState<Id<"runs"> | null>(null)
  const [applyRunId, setApplyRunId] = useState<Id<"runs"> | null>(null)
  const finalizeAttemptedBootstrapRunRef = useRef<string | null>(null)

  function setStepStatus(id: FinalizeStepId, status: FinalizeStepStatus, detail?: string): void {
    setFinalizeUpdatedAt(Date.now())
    setFinalizeSteps((prev) => prev.map((row) => (
      row.id === id ? { ...row, status, detail } : row
    )))
  }

  function setPredeployCheck(id: PredeployCheckId, state: PredeployCheckState, detail?: string): void {
    setPredeployChecks((prev) =>
      prev.map((row) => (row.id === id ? { ...row, state, detail } : row)),
    )
  }

  const predeployFingerprint = useMemo(
    () =>
      JSON.stringify({
        host: props.host,
        selectedRev: selectedRev ?? "",
        repoDirty: dirtyRepo,
        repoNeedsPush: needsPush,
        runnerOnline,
        runnerNixReady: runnerNixReadiness.ready,
        infra: desired.infrastructure,
        connection: desired.connection,
        hasProjectGithubToken: props.hasProjectGithubToken,
        hasProjectGitRemoteOrigin: props.hasProjectGitRemoteOrigin,
        projectGitRemoteOrigin: props.projectGitRemoteOrigin,
        hasHostTailscaleAuthKey: tailscaleAuthKeyConfigured,
        requiresTailscaleAuthKey,
        requiredHostSecretsConfigured,
        useTailscaleLockdown: wantsTailscaleLockdown,
        adminPasswordRequired,
        adminPasswordSet: Boolean(props.pendingBootstrapSecrets.adminPassword.trim()),
      }),
      [
        desired.connection,
        desired.infrastructure,
        props.hasProjectGithubToken,
        props.hasProjectGitRemoteOrigin,
        props.projectGitRemoteOrigin,
        tailscaleAuthKeyConfigured,
        requiresTailscaleAuthKey,
        requiredHostSecretsConfigured,
        props.host,
        props.pendingBootstrapSecrets.adminPassword,
        adminPasswordRequired,
        runnerNixReadiness.ready,
        runnerOnline,
      selectedRev,
      dirtyRepo,
      needsPush,
      wantsTailscaleLockdown,
    ],
  )
  const predeployFingerprintRef = useRef(predeployFingerprint)

  useEffect(() => {
    predeployFingerprintRef.current = predeployFingerprint
  }, [predeployFingerprint])

  useEffect(() => {
    setPreparedRev(null)
  }, [projectId, props.host])

  useEffect(() => {
    if (predeployState !== "ready") return
    if (predeployReadyFingerprint === predeployFingerprint) return
    setPredeployState("idle")
    setPredeployChecks(initialPredeployChecks())
    setPredeployError("Predeploy summary is stale. Re-run checks.")
    setPredeployReadyFingerprint(null)
    setPredeployUpdatedAt(null)
    setPreparedRev(null)
  }, [predeployFingerprint, predeployReadyFingerprint, predeployState])

  useEffect(() => {
    if (!latestBootstrapRunId) return
    if (!latestBootstrapRunning) return
    // Always track the latest running bootstrap run. Otherwise the UI can get stuck
    // tailing an older run after retries or multi-tab deploy attempts.
    setBootstrapRunId(latestBootstrapRunId)
    setBootstrapStatus("running")
    setBootstrapFinalizeArmed(true)
  }, [latestBootstrapRunning, latestBootstrapRunId])

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
      setFinalizeUpdatedAt(null)

      let targetHost = String(hostSummary?.desired?.targetHost || "").trim()
      const isTailnetTargetHost = (value: string) => /^admin@100\./.test(value)
      const switchTailnetWaitMs = 10 * 60_000
      const switchTailnetPollMs = 5_000
      const sshReachabilityWaitMs = 5 * 60_000
      const sshReachabilityPollMs = 5_000
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

      await runFinalizeStep({
        id: "setTargetHost",
        run: async () => {
          if (isTailnetTargetHost(targetHost)) return `Already set: ${targetHost}`
          const ipv4 = await getHostPublicIpv4({
            data: {
              projectId: projectId as Id<"projects">,
              host: props.host,
            },
          })
          if (!ipv4.ok) throw new Error(ipv4.error || "Could not find public IPv4")
          if (!ipv4.ipv4) throw new Error("Could not find public IPv4")
          const publicTargetHost = `admin@${ipv4.ipv4}`
          if (targetHost === publicTargetHost) return `Already set: ${targetHost}`
          targetHost = publicTargetHost
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

      if (!wantsTailscaleLockdown) {
        setStepStatus("switchTailnetTarget", "skipped", "Auto-lockdown disabled")
        setStepStatus("switchSshExposure", "skipped", "Auto-lockdown disabled")
        setStepStatus("lockdown", "skipped", "Auto-lockdown disabled")
      } else if (!tailscaleAuthKeyConfigured) {
        setStepStatus("switchTailnetTarget", "skipped", "tailscale_auth_key missing")
        setStepStatus("switchSshExposure", "skipped", "tailscale_auth_key missing")
        setStepStatus("lockdown", "skipped", "tailscale_auth_key missing")
      } else {
        await runFinalizeStep({
          id: "switchTailnetTarget",
          run: async () => {
            if (!targetHost.trim()) throw new Error("targetHost missing")
            setStepStatus("switchTailnetTarget", "running", `Waiting for SSH via ${targetHost}...`)
            const sshProbe = await probeSshReachability({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
                targetHost,
                wait: true,
                waitTimeoutMs: sshReachabilityWaitMs,
                waitPollMs: sshReachabilityPollMs,
              },
            })
            if (!sshProbe.ok) {
              throw new Error(sshProbe.error || `SSH not reachable within ${sshReachabilityWaitMs}ms`)
            }

            setStepStatus("switchTailnetTarget", "running", `Waiting for tailnet IPv4 via ${targetHost}...`)
            const probe = await probeHostTailscaleIpv4({
              data: {
                projectId: projectId as Id<"projects">,
                host: props.host,
                targetHost,
                wait: true,
                waitTimeoutMs: switchTailnetWaitMs,
                waitPollMs: switchTailnetPollMs,
              },
            })
            if (probe.ok && probe.ipv4) {
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
            }
            if (!probe.ok) throw new Error(probe.error || "Could not resolve tailnet IPv4")
            throw new Error("Could not resolve tailnet IPv4")
          },
        })

        await runFinalizeStep({
          id: "switchSshExposure",
          run: async () => {
            const setTailnetMode = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.tailnet.mode`,
                value: "tailscale",
              },
            })
            if (!setTailnetMode.ok) throw new Error(extractIssueMessage(setTailnetMode, "Could not set tailnet mode"))
            const setSshExposure = await configDotSet({
              data: {
                projectId: projectId as Id<"projects">,
                path: `hosts.${props.host}.sshExposure.mode`,
                value: "tailnet",
              },
            })
            if (!setSshExposure.ok) throw new Error(extractIssueMessage(setSshExposure, "Could not switch SSH exposure"))
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
      setFinalizeState("running")
      setBootstrapFinalizeArmed(false)
      toast.success("Server hardening queued")
      void queryClient.invalidateQueries({
        queryKey: ["gitRepoStatus", projectId],
      })
      void queryClient.invalidateQueries({
        queryKey: setupConfigProbeQueryKey(projectId),
      })
      void queryClient.invalidateQueries(
        convexQuery(
          api.controlPlane.runs.latestByProjectHostKind,
          projectId && props.host
            ? {
                projectId,
                host: props.host,
                kind: "lockdown",
              }
            : "skip",
        ),
      )
      void queryClient.invalidateQueries(
        convexQuery(
          api.controlPlane.runs.latestByProjectHostKind,
          projectId && props.host
            ? {
                projectId,
                host: props.host,
                kind: "server_update_apply",
              }
            : "skip",
        ),
      )
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setFinalizeState("failed")
      setBootstrapFinalizeArmed(false)
      setFinalizeError(message)
      toast.error(message)
    },
  })

  async function saveDraftAndQueuePredeploy(params: {
    desired: ReturnType<typeof deriveEffectiveSetupDesiredState>
    adminPasswordRequired: boolean
    adminPassword: string
  }): Promise<{ pinnedRev: string; repoStatus: Awaited<ReturnType<typeof gitRepoStatus>> }> {
    if (!projectId) throw new Error("Project not ready")

    const infrastructurePatch: SetupDraftInfrastructure = {
      serverType: params.desired.infrastructure.serverType,
      image: params.desired.infrastructure.image,
      location: params.desired.infrastructure.location,
      allowTailscaleUdpIngress: params.desired.infrastructure.allowTailscaleUdpIngress,
    }
    const connectionPatch: SetupDraftConnection = {
      adminCidr: params.desired.connection.adminCidr,
      sshExposureMode: params.desired.connection.sshExposureMode,
      sshKeyCount: params.desired.connection.sshKeyCount,
      sshAuthorizedKeys: params.desired.connection.sshAuthorizedKeys,
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
    if (params.adminPasswordRequired && !params.adminPassword) {
      throw new Error("Server access incomplete. Set admin password.")
    }

    const savedNonSecretDraft = await setupDraftSaveNonSecret({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
        patch: {
          infrastructure: infrastructurePatch,
          connection: {
            ...connectionPatch,
            sshKeyCount: connectionPatch.sshAuthorizedKeys.length,
          },
        },
      },
    })

    const preferredRunnerId = savedNonSecretDraft?.sealedSecretDrafts?.hostBootstrapCreds?.targetRunnerId
      || props.setupDraft?.sealedSecretDrafts?.hostBootstrapCreds?.targetRunnerId
    const targetRunner = preferredRunnerId
      ? sealedRunners.find((runner) => String(runner._id) === String(preferredRunnerId))
      : sealedRunners[0] ?? null
    if (!targetRunner) throw new Error("No sealed-capable runner online. Start runner and retry.")

    const targetRunnerId = String(targetRunner._id) as Id<"runners">
    const runnerPub = String(targetRunner.capabilities?.sealedInputPubSpkiB64 || "").trim()
    const keyId = String(targetRunner.capabilities?.sealedInputKeyId || "").trim()
    const alg = String(targetRunner.capabilities?.sealedInputAlg || "").trim()
    if (!runnerPub || !keyId || !alg) throw new Error("Runner sealed-input capabilities incomplete")

    const ensuredHostSopsKey = await generateSopsAgeKey({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
      },
    })
    if (!ensuredHostSopsKey.ok) {
      throw new Error(ensuredHostSopsKey.message || "Could not prepare host-scoped SOPS key for setup.")
    }
    const hostScopedSopsAgeKeyPath = String(ensuredHostSopsKey.keyPath || "").trim()
    if (!hostScopedSopsAgeKeyPath) throw new Error("Could not prepare host-scoped SOPS key for setup.")

    let currentDraftVersion = savedNonSecretDraft?.version
    const deployCredsPayload: Record<string, string> = {
      SOPS_AGE_KEY_FILE: hostScopedSopsAgeKeyPath,
    }
    const deployCredsAad = buildSetupDraftSectionAad({
      projectId: projectId as Id<"projects">,
      host: props.host,
      section: "hostBootstrapCreds",
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
        section: "hostBootstrapCreds",
        targetRunnerId,
        sealedInputB64: deployCredsSealedInputB64,
        sealedInputAlg: alg,
        sealedInputKeyId: keyId,
        aad: deployCredsAad,
        expectedVersion: currentDraftVersion,
      },
    })
    currentDraftVersion = savedDeployCredsDraft.version

    const bootstrapSecretsPayload: Record<string, string> = {}
    if (params.adminPassword) bootstrapSecretsPayload.adminPassword = params.adminPassword

    const bootstrapSecretsAad = buildSetupDraftSectionAad({
      projectId: projectId as Id<"projects">,
      host: props.host,
      section: "hostBootstrapSecrets",
      targetRunnerId,
    })
    const bootstrapSecretsSealedInputB64 = await sealForRunner({
      runnerPubSpkiB64: runnerPub,
      keyId,
      alg,
      aad: bootstrapSecretsAad,
      plaintextJson: JSON.stringify(bootstrapSecretsPayload),
    })
    await setupDraftSaveSealedSection({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
        section: "hostBootstrapSecrets",
        targetRunnerId,
        sealedInputB64: bootstrapSecretsSealedInputB64,
        sealedInputAlg: alg,
        sealedInputKeyId: keyId,
        aad: bootstrapSecretsAad,
        expectedVersion: currentDraftVersion,
      },
    })

    await queryClient.invalidateQueries({ queryKey: ["setupDraft", projectId, props.host] })
    setPredeployCheck("sealedDrafts", "passed", "Host bootstrap secrets queued")

    setPredeployCheck("setupApply", "pending", "Running setup apply...")
    const setupApply = await setupDraftCommit({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
      },
    })
    setSetupApplyRunId(setupApply.runId)

    const doctor = await runDoctor({
      data: {
        projectId: projectId as Id<"projects">,
        host: props.host,
        scope: "repo",
      },
    })
    setPredeployCheck(
      "setupApply",
      "passed",
      `setup_apply ${String(setupApply.runId)}; doctor ${String(doctor.runId)}`,
    )

    setPredeployCheck("saveToGit", "pending", "Committing and pushing setup changes...")
    try {
      const saved = await gitSetupSaveExecute({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
        },
      })
      const pinnedRev = String(saved.result?.sha || "").trim()
      if (!pinnedRev) throw new Error("git setup-save did not return a revision")
      setPreparedRev(pinnedRev)
      const changedCount = Array.isArray(saved.result?.changedPaths) ? saved.result.changedPaths.length : 0
      const commitVerb = saved.result.committed ? "Committed" : "No changes"
      const pushVerb = saved.result.pushed ? "pushed" : "push skipped"
      setPredeployCheck(
        "saveToGit",
        "passed",
        `${commitVerb}; ${pushVerb}; revision ${pinnedRev.slice(0, 7)}; files ${changedCount}`,
      )

      setPredeployCheck("repo", "pending", "Refreshing repo state...")
      const repoStatusAfter = await gitRepoStatus({ data: { projectId: projectId as Id<"projects"> } })
      queryClient.setQueryData(["gitRepoStatus", projectId], repoStatusAfter)
      const repoAfterReadiness = deriveDeployReadiness({
        runnerOnline: true,
        repoPending: false,
        repoError: null,
        dirty: Boolean(repoStatusAfter.dirty),
        missingRev: !repoStatusAfter.originHead,
        needsPush: Boolean(repoStatusAfter.needsPush),
        localSelected: false,
        allowLocalDeploy: false,
      })
      if (repoAfterReadiness.blocksDeploy) {
        const message = repoAfterReadiness.message || "Repo not ready"
        setPredeployCheck("repo", "failed", message)
        throw new Error(message)
      }
      setPredeployCheck("repo", "passed", repoStatusAfter.originHead ? `revision ${repoStatusAfter.originHead.slice(0, 7)}` : "ready")
      return { pinnedRev, repoStatus: repoStatusAfter }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPredeployCheck("saveToGit", "failed", message || "git setup-save failed")
      throw error
    }
  }

  const runPredeploy = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      setPredeployState("running")
      setPredeployError(null)
      setPredeployChecks(initialPredeployChecks())
      setPredeployReadyFingerprint(null)
      setPreparedRev(null)

      if (!runnerOnline) {
        setPredeployCheck("runner", "failed", "Runner offline")
        throw new Error("Runner offline. Start runner first.")
      }
      if (!runnerNixReadiness.ready) {
        setPredeployCheck("runner", "failed", nixGateMessage || "Runner missing Nix")
        throw new Error(nixGateMessage || "Runner is online but Nix is missing.")
      }
      if (sealedRunners.length === 0) {
        setPredeployCheck("runner", "failed", "No sealed-capable runner online")
        throw new Error("No sealed-capable runner online. Start runner and retry.")
      }
      setPredeployCheck("runner", "passed", "Runner online and sealed-capable")

      setPredeployCheck("repo", "pending", "Checking repo state...")
      let repoStatusNow: Awaited<ReturnType<typeof gitRepoStatus>>
      try {
        repoStatusNow = await gitRepoStatus({ data: { projectId: projectId as Id<"projects"> } })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setPredeployCheck("repo", "failed", message || "Repo state unavailable")
        throw error
      }
      queryClient.setQueryData(["gitRepoStatus", projectId], repoStatusNow)

      const selectedRevNow = repoStatusNow.originHead
      const missingRevNow = !selectedRevNow
      const needsPushNow = Boolean(repoStatusNow.needsPush)
      const dirtyNow = Boolean(repoStatusNow.dirty)
      const repoReadiness = deriveDeployReadiness({
        runnerOnline: true,
        repoPending: false,
        repoError: null,
        dirty: dirtyNow,
        missingRev: missingRevNow,
        needsPush: needsPushNow,
        localSelected: false,
        allowLocalDeploy: false,
      })
      if (repoReadiness.blocksDeploy) {
        const message = repoReadiness.message || "Repo not ready"
        setPredeployCheck("repo", "failed", message)
        throw new Error(message)
      }
      setPredeployCheck("repo", "passed", selectedRevNow ? `revision ${selectedRevNow.slice(0, 7)}` : "ready")

      // Ensure setup config is loaded so SSH key checks don't fail with "checking..." race.
      let setupConfigNow = setupConfigQuery.data ?? null
      if (!setupConfigNow) {
        try {
          setupConfigNow = await queryClient.fetchQuery(setupConfigProbeQueryOptions(projectId))
        } catch {
          setupConfigNow = null
        }
      }
      const desiredNow = deriveEffectiveSetupDesiredState({
        config: setupConfigNow,
        host: props.host,
        setupDraft: props.setupDraft,
        pendingNonSecretDraft: {
          infrastructure: props.pendingInfrastructureDraft ?? undefined,
          connection: props.pendingConnectionDraft ?? undefined,
        },
      })

      if (desiredNow.connection.sshAuthorizedKeys.length < 1) {
        setPredeployCheck("ssh", "failed", "SSH key required. Add at least one key in Server Access.")
        throw new Error("SSH key required. Add at least one key in Server Access.")
      }
      setPredeployCheck("ssh", "passed", `${desiredNow.connection.sshAuthorizedKeys.length} key(s)`)

      // Refresh wiring so admin_password_hash doesn't incorrectly appear missing while query is still loading.
      let adminPasswordConfiguredNow = adminPasswordConfigured
      try {
        const secretWiringNow = await secretWiringQuery.refetch().then((res) => res.data ?? [])
        adminPasswordConfiguredNow = secretWiringNow.some(
          (row) => row.secretName === "admin_password_hash" && row.status === "configured",
        )
      } catch {
        // Fall back to current query state; require password if uncertain.
        adminPasswordConfiguredNow = adminPasswordConfigured
      }
      const adminPasswordRequiredNow = !adminPasswordConfiguredNow
      const adminPasswordNow = props.pendingBootstrapSecrets.adminPassword.trim()

      if (adminPasswordRequiredNow && !adminPasswordNow) {
        setPredeployCheck("adminPassword", "failed", "Server access incomplete. Set admin password.")
        throw new Error("Server access incomplete. Set admin password.")
      }
      setPredeployCheck(
        "adminPassword",
        "passed",
        adminPasswordRequiredNow ? "provided for bootstrap" : "existing admin_password_hash configured",
      )

      const requiredTailscaleAuthKeyNow = isTailnet || desiredNow.connection.sshExposureMode === "tailnet"
      if (requiredTailscaleAuthKeyNow && !tailscaleAuthKeyConfigured) {
        setPredeployCheck(
          "requiredHostSecrets",
          "failed",
          "Missing tailscale_auth_key. Configure it in Tailscale lockdown (per host).",
        )
        throw new Error("Missing required tailscale_auth_key for tailscale bootstrap.")
      }

      const requiredHostSecretsDetail = requiredTailscaleAuthKeyNow
        ? "tailscale_auth_key configured"
        : "No additional required host secrets"

      setPredeployCheck(
        "requiredHostSecrets",
        "passed",
        requiredHostSecretsDetail,
      )

      if (credsGateBlocked) {
        setPredeployCheck("projectCreds", "failed", projectCredsFailureDetail)
        throw new Error(credsGateMessage || "Project credentials missing.")
      }
      const remoteUrl = props.projectGitRemoteOrigin.trim()
      const targetRunner = sealedRunners[0]
      if (!targetRunner) {
        setPredeployCheck("projectCreds", "failed", "No sealed runner available for credentials")
        throw new Error("No sealed-capable runner online for credentials.")
      }
      if (remoteUrl) {
        setPredeployCheck("projectCreds", "pending", "Setting git remote origin")
        await queueDeployCredsUpdate({
          data: {
            projectId: projectId as Id<"projects">,
            targetRunnerId: String(targetRunner._id) as Id<"runners">,
            updates: {
              GIT_REMOTE_ORIGIN: remoteUrl,
            },
          },
        })
      }
      setPredeployCheck("projectCreds", "passed", projectCredsPassedDetail)

      const predeployResult = await saveDraftAndQueuePredeploy({
        desired: desiredNow,
        adminPasswordRequired: adminPasswordRequiredNow,
        adminPassword: adminPasswordNow,
      })
      setPredeployState("ready")
      const predeployFingerprintNow = JSON.stringify({
        host: props.host,
        selectedRev: predeployResult.pinnedRev,
        repoDirty: Boolean(predeployResult.repoStatus.dirty),
        repoNeedsPush: Boolean(predeployResult.repoStatus.needsPush),
        runnerOnline,
        runnerNixReady: runnerNixReadiness.ready,
        infra: desiredNow.infrastructure,
        connection: desiredNow.connection,
        hasProjectGithubToken: props.hasProjectGithubToken,
        hasProjectGitRemoteOrigin: props.hasProjectGitRemoteOrigin,
        projectGitRemoteOrigin: props.projectGitRemoteOrigin,
        hasHostTailscaleAuthKey: tailscaleAuthKeyConfigured,
        requiresTailscaleAuthKey: requiredTailscaleAuthKeyNow,
        requiredHostSecretsConfigured: tailscaleAuthKeyConfigured,
        useTailscaleLockdown: wantsTailscaleLockdown,
        adminPasswordRequired: adminPasswordRequiredNow,
        adminPasswordSet: Boolean(props.pendingBootstrapSecrets.adminPassword.trim()),
      })
      setPredeployReadyFingerprint(predeployFingerprintNow)
      setPredeployUpdatedAt(Date.now())
      return true
    },
    onSuccess: () => {
      toast.success("Predeploy checks passed")
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      setPredeployState("failed")
      setPredeployError(message)
      toast.error(message)
    },
  });

  const saveToGitNow = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      const saved = await gitSetupSaveExecute({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
        },
      })
      const pinnedRev = String(saved.result?.sha || "").trim()
      if (!pinnedRev) throw new Error("git setup-save did not return a revision")
      const repoStatusAfter = await gitRepoStatus({ data: { projectId: projectId as Id<"projects"> } })
      queryClient.setQueryData(["gitRepoStatus", projectId], repoStatusAfter)
      const changedCount = Array.isArray(saved.result?.changedPaths) ? saved.result.changedPaths.length : 0
      const commitVerb = saved.result.committed ? "Committed" : "No changes"
      const pushVerb = saved.result.pushed ? "pushed" : "push skipped"
      setPreparedRev(pinnedRev)
      return {
        pinnedRev,
        changedCount,
        commitVerb,
        pushVerb,
      }
    },
    onSuccess: ({ pinnedRev, changedCount, commitVerb, pushVerb }) => {
      toast.success(
        `Saved to git: ${commitVerb}; ${pushVerb}; revision ${pinnedRev.slice(0, 7)}; files ${changedCount}`,
      )
      setPredeployState("idle")
      setPredeployError(null)
      setPredeployChecks(initialPredeployChecks())
      setPredeployReadyFingerprint(null)
      setPredeployUpdatedAt(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  });

  const startDeploy = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Project not ready")
      if (!props.host.trim()) throw new Error("Host is required")
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      if (predeployState !== "ready" || predeployReadyFingerprint !== predeployFingerprint) {
        throw new Error("Run predeploy checks first and confirm green summary.")
      }
      if (!selectedRev) throw new Error("No pushed revision found.")
      finalizeAttemptedBootstrapRunRef.current = null
      setFinalizeState("idle")
      setFinalizeError(null)
      setFinalizeSteps(initialFinalizeSteps())
      setLockdownRunId(null)
      setApplyRunId(null)
      if (canAutoLockdown && !isTailnet) {
        const setTailnetMode = await configDotSet({
          data: {
            projectId: projectId as Id<"projects">,
            path: `hosts.${props.host}.tailnet.mode`,
            value: "tailscale",
          },
        })
        if (!setTailnetMode.ok) throw new Error(extractIssueMessage(setTailnetMode, "Could not set tailnet mode"))
      }

      const started = await bootstrapStart({
        data: {
          projectId: projectId as Id<"projects">,
          host: props.host,
          mode: "nixos-anywhere",
        },
      })
      setBootstrapRunId(started.runId)
      setBootstrapStatus("running")
      setBootstrapFinalizeArmed(true)
      if (!started.reused) {
        await bootstrapExecute({
          data: {
            projectId: projectId as Id<"projects">,
            runId: started.runId,
            host: props.host,
            mode: "nixos-anywhere",
            force: false,
            dryRun: false,
            // Post-bootstrap hardening is handled by the setup UI flow (lockdown + apply updates).
            // Keep public SSH reachable (admin CIDR) until hardening completes.
            lockdownAfter: false,
            rev: selectedRev,
          },
        })
      }
      return started
    },
    onSuccess: (res) => {
      toast.info(res.reused ? "Deploy already running" : "Deploy started")
    },
    onError: (error) => {
      setBootstrapStatus("failed")
      setBootstrapFinalizeArmed(false)
      toast.error(error instanceof Error ? error.message : String(error))
    },
  });

  const bootstrapSucceeded = latestBootstrapSucceeded || props.hasBootstrapped || bootstrapStatus === "succeeded"
  const bootstrapFailed = latestBootstrapFailed || bootstrapStatus === "failed"
  const effectiveBootstrapStatus: "idle" | "running" | "succeeded" | "failed" = latestBootstrapRunning
    ? "running"
    : infraMissing
      ? "idle"
      : bootstrapSucceeded
        ? "succeeded"
        : bootstrapFailed
          ? "failed"
          : "idle"
  const isBootstrapped = effectiveBootstrapStatus === "succeeded"
  const bootstrapInProgress = effectiveBootstrapStatus === "running"
  const latestBootstrapStartedAt = Number(latestBootstrapRun?.startedAt || 0)
  const latestLockdownRun = latestLockdownRunQuery.data ?? null
  const latestApplyRun = latestApplyRunQuery.data ?? null
  const latestLockdownStartedAt = Number(latestLockdownRun?.startedAt || 0)
  const latestApplyStartedAt = Number(latestApplyRun?.startedAt || 0)
  const latestLockdownForCurrentBootstrap = latestBootstrapStartedAt > 0 && latestLockdownStartedAt >= latestBootstrapStartedAt
    ? latestLockdownRun
    : null
  const latestApplyForCurrentBootstrap = latestBootstrapStartedAt > 0 && latestApplyStartedAt >= latestBootstrapStartedAt
    ? latestApplyRun
    : null
  const latestLockdownRunStatus = String(latestLockdownForCurrentBootstrap?.status || "").trim()
  const latestApplyRunStatus = String(latestApplyForCurrentBootstrap?.status || "").trim()
  const latestLockdownRunning = latestLockdownRunStatus === "queued" || latestLockdownRunStatus === "running"
  const latestLockdownFailed = latestLockdownRunStatus === "failed" || latestLockdownRunStatus === "canceled"
  const latestApplyRunning = latestApplyRunStatus === "queued" || latestApplyRunStatus === "running"
  const latestApplySucceeded = latestApplyRunStatus === "succeeded"
  const latestApplyFailed = latestApplyRunStatus === "failed" || latestApplyRunStatus === "canceled"
  const persistedFinalizeState: FinalizeState = !isBootstrapped
    ? "idle"
    : latestApplyRunning
      ? "running"
      : latestApplySucceeded
        ? "succeeded"
        : latestApplyFailed || latestLockdownFailed
          ? "failed"
          : latestLockdownRunning
            ? "running"
            : "idle"
  const effectiveFinalizeState: FinalizeState = finalizeState === "running"
    ? "running"
    : persistedFinalizeState !== "idle"
      ? persistedFinalizeState
      : finalizeState === "failed" || finalizeState === "succeeded"
        ? finalizeState
        : "idle"
  const effectiveBootstrapRunId = bootstrapRunId ?? latestBootstrapRunId
  const effectiveLockdownRunId = lockdownRunId ?? (latestLockdownForCurrentBootstrap?._id as Id<"runs"> | null)
  const effectiveApplyRunId = applyRunId ?? (latestApplyForCurrentBootstrap?._id as Id<"runs"> | null)
  const shouldAutoStartFinalize = isBootstrapped
    && infraExists === true
    && effectiveFinalizeState === "idle"
    && !startFinalize.isPending
  const predeployReady = predeployState === "ready" && predeployReadyFingerprint === predeployFingerprint
  const canRunPredeploy = !isBootstrapped
    && !runPredeploy.isPending
    && !startDeploy.isPending
    && !bootstrapInProgress
    && runnerOnline
    && Boolean(projectId)
  const mainActionIsSaveToGit = showRepoSaveToGitButton && !predeployReady
  const canRunSaveToGit = !isBootstrapped
    && !runPredeploy.isPending
    && !saveToGitNow.isPending
    && !bootstrapInProgress
    && runnerOnline
    && Boolean(projectId)
    && showRepoSaveToGitButton
  const canStartDeploy = !isBootstrapped
    && !startDeploy.isPending
    && !bootstrapInProgress
    && predeployReady
    && runnerOnline
    && Boolean(projectId)
  const finalizeRecoveryMessage = wantsTailscaleLockdown
    ? "Automatic hardening failed. Retry Activate VPN & lockdown."
    : "Automatic hardening failed. Review run logs before continuing."
  const showVpnRecoveryCta = isBootstrapped && infraExists === true && effectiveFinalizeState === "failed" && wantsTailscaleLockdown
  const openClawSetupPath = `/${props.projectSlug}/hosts/${props.host}/openclaw-setup`
  const hostOverviewPath = `/${props.projectSlug}/hosts/${props.host}`
  const cardStatus = !isBootstrapped
    ? infraMissing
      ? infraMissingDetail
        ? `Infrastructure missing. ${infraMissingDetail}`
        : "Infrastructure missing (likely destroyed). Redeploy required."
      : bootstrapInProgress
        ? "Deploy in progress..."
        : predeployState === "running"
          ? "Running predeploy checks..."
          : predeployReady
            ? "Predeploy checks are green. Review summary, then deploy."
            : predeployState === "failed"
              ? predeployError || "Predeploy checks failed."
              : deployStatusReason
    : effectiveFinalizeState === "running"
      ? "Auto-hardening running..."
      : effectiveFinalizeState === "failed"
        ? finalizeError || finalizeRecoveryMessage
      : shouldAutoStartFinalize || bootstrapFinalizeArmed
          ? "Preparing post-bootstrap hardening..."
          : "Server installed. Ready for OpenClaw."

  const showSuccessBanner = isBootstrapped && effectiveFinalizeState !== "succeeded"
  const showInstalledCard = isBootstrapped && effectiveFinalizeState === "succeeded"
  const successMessage = effectiveFinalizeState === "running" || shouldAutoStartFinalize
    ? "Initial install succeeded. Post-bootstrap hardening is running."
    : effectiveFinalizeState === "succeeded"
      ? "Initial install succeeded and post-bootstrap hardening was queued automatically."
      : effectiveFinalizeState === "failed"
        ? `Initial install succeeded, but post-bootstrap hardening failed. ${finalizeRecoveryMessage}`
        : "Server deployed. Post-deploy summary is ready."

  useEffect(() => {
    if (!shouldAutoStartFinalize) return
    if (!latestBootstrapRunId) return
    const runKey = String(latestBootstrapRunId)
    if (finalizeAttemptedBootstrapRunRef.current === runKey) return
    finalizeAttemptedBootstrapRunRef.current = runKey
    setBootstrapFinalizeArmed(true)
    startFinalize.mutate()
  }, [latestBootstrapRunId, shouldAutoStartFinalize, startFinalize])

  return (
    <SettingsSection
      title="Install server"
      description="Deploy this host with safe defaults. Advanced controls stay on the full deploy page."
      headerBadge={props.headerBadge}
      statusText={cardStatus}
      actions={!isBootstrapped ? (
        bootstrapInProgress ? (
          <AsyncButton type="button" disabled pending pendingText="Deploying...">
            Deploy now
          </AsyncButton>
        ) : predeployReady ? (
          <AsyncButton
            type="button"
            disabled={!canStartDeploy}
            pending={startDeploy.isPending || bootstrapInProgress}
            pendingText="Deploying..."
            onClick={() => startDeploy.mutate()}
          >
            Deploy now
          </AsyncButton>
        ) : mainActionIsSaveToGit ? (
          <AsyncButton
            type="button"
            disabled={!canRunSaveToGit}
            pending={saveToGitNow.isPending}
            pendingText="Saving and continuing..."
            onClick={() => {
              saveToGitNow.mutate(undefined, { onSuccess: () => runPredeployAfterSave() })
            }}
          >
            Save to git and continue
          </AsyncButton>
        ) : (
          <AsyncButton
            type="button"
            disabled={!canRunPredeploy}
            pending={runPredeploy.isPending}
            pendingText="Checking..."
            onClick={() => runPredeploy.mutate()}
          >
            Run predeploy
          </AsyncButton>
        )
      ) : effectiveFinalizeState === "running" || shouldAutoStartFinalize || bootstrapFinalizeArmed ? (
        <AsyncButton
          type="button"
          disabled
          pending
          pendingText={effectiveFinalizeState === "running" ? "Finishing..." : "Starting hardening..."}
        >
          Finalizing
        </AsyncButton>
      ) : showVpnRecoveryCta ? (
        <AsyncButton
          type="button"
          disabled={startFinalize.isPending}
          pending={startFinalize.isPending}
          pendingText="Starting..."
          onClick={() => startFinalize.mutate()}
        >
          Retry Activate VPN & lockdown
        </AsyncButton>
      ) : showInstalledCard ? (
        <Button
          type="button"
          nativeButton={false}
          render={<Link to={openClawSetupPath} />}
        >
          Install OpenClaw
        </Button>
      ) : (
        <Button
          type="button"
          nativeButton={false}
          render={<Link to={hostOverviewPath} />}
        >
          Open host overview
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
            variant={adminCidrWorldOpen ? "destructive" : "default"}
            className={adminCidrWorldOpen
              ? undefined
              : "border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"}
          >
            <AlertTitle>{adminCidrWorldOpen ? "Auto-lockdown pending (SSH world-open)" : "Auto-lockdown pending"}</AlertTitle>
            <AlertDescription>
              <div>
                Current SSH mode: <code>{desiredSshExposureMode || "bootstrap"}</code>.
                Admin CIDR: <code>{adminCidr || "unset"}</code>.
              </div>
              {autoLockdownMissingTailscaleKey ? (
                <div className="pt-1">Add an active project Tailscale auth key to enable automatic lockdown.</div>
              ) : null}
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

          {!isBootstrapped && adminPasswordGateMessage && !repoGateBlocked && !nixGateBlocked && !sshKeyGateBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>Admin password required</AlertTitle>
              <AlertDescription>
                <div>{adminPasswordGateMessage}</div>
              </AlertDescription>
            </Alert>
          ) : null}

          {!isBootstrapped && credsGateMessage && !repoGateBlocked && !nixGateBlocked && !sshKeyGateBlocked && !adminPasswordGateBlocked ? (
            <Alert variant="destructive">
              <AlertTitle>{deployCredsGateAlertTitle}</AlertTitle>
              <AlertDescription>
                <div>{credsGateMessage}</div>
                {githubTokenAccessText ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {githubTokenAccessText}
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
          {showRepoSaveToGitButton ? (
            <Alert variant="default">
              <AlertTitle>Git must be pushed</AlertTitle>
              <AlertDescription>
                <div className="text-sm">
                  Deploy needs a committed and pushed revision. Use <strong>Save to git and continue</strong> to run this automatically.
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Manual alternative:
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/20 p-2 text-xs">
                  {repoSaveManualCommand}
                </pre>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        {!isBootstrapped && predeployState === "failed" && predeployError ? (
          <Alert variant="destructive">
            <AlertTitle>Predeploy failed</AlertTitle>
            <AlertDescription>{predeployError}</AlertDescription>
          </Alert>
        ) : null}

        {!isBootstrapped && predeployState !== "idle" ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Predeploy summary</div>
              <Badge variant={predeployReady ? "secondary" : predeployState === "failed" ? "destructive" : "outline"}>
                {predeployReady ? "Green" : predeployState === "failed" ? "Failed" : "Running"}
              </Badge>
            </div>
            <div className="space-y-1.5">
              {predeployChecks.map((check) => (
                <div key={check.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-2 py-1.5">
                  <div className="min-w-0 text-xs">
                    <div className="font-medium">{check.label}</div>
                    {check.detail ? <div className="truncate text-muted-foreground">{check.detail}</div> : null}
                  </div>
                  <Badge
                    variant={
                      check.state === "passed"
                        ? "secondary"
                        : check.state === "failed"
                          ? "destructive"
                          : "outline"
                    }
                    className="shrink-0"
                  >
                    {check.state === "pending" && predeployState === "running" ? <Spinner className="mr-1 size-3" /> : null}
                    {check.state === "passed" ? "Passed" : check.state === "failed" ? "Failed" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
            {predeployUpdatedAt ? (
              <div className="text-xs text-muted-foreground">
                Last update: {new Date(predeployUpdatedAt).toLocaleTimeString()}
              </div>
            ) : null}
          </div>
        ) : null}

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

        {effectiveFinalizeState !== "idle" || shouldAutoStartFinalize ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Lockdown summary</div>
              <Badge
                variant={
                  effectiveFinalizeState === "succeeded"
                    ? "secondary"
                    : effectiveFinalizeState === "failed"
                      ? "destructive"
                      : "outline"
                }
              >
                {effectiveFinalizeState === "succeeded" ? "Done" : effectiveFinalizeState === "failed" ? "Failed" : "Running"}
              </Badge>
            </div>
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
            {finalizeUpdatedAt ? (
              <div className="text-xs text-muted-foreground">
                Last update: {new Date(finalizeUpdatedAt).toLocaleTimeString()}
              </div>
            ) : null}
          </div>
        ) : null}

        {showInstalledCard ? (
          <SetupCelebration
            title="Server installed"
            description={wantsTailscaleLockdown
              ? "Post-deploy hardening completed. Next: install OpenClaw."
              : "Server installed with SSH-only mode as configured. You can enable Tailscale lockdown later from VPN settings. Next: install OpenClaw."}
            primaryLabel="Install OpenClaw"
            primaryTo={openClawSetupPath}
            secondaryLabel="Go to host overview"
            secondaryTo={hostOverviewPath}
          />
        ) : null}

        {effectiveBootstrapRunId ? (
          <RunLogTail
            runId={effectiveBootstrapRunId}
            onDone={(status) => {
              if (status === "succeeded") {
                setBootstrapStatus("succeeded")
              } else if (status === "failed" || status === "canceled") {
                setBootstrapStatus("failed")
                setBootstrapFinalizeArmed(false)
              }
            }}
          />
        ) : null}

        {setupApplyRunId ? <RunLogTail runId={setupApplyRunId} /> : null}
        {effectiveLockdownRunId ? (
          <RunLogTail
            runId={effectiveLockdownRunId}
            onDone={(status) => {
              if (status === "failed" || status === "canceled") {
                setFinalizeState("failed")
                setFinalizeError("Lockdown failed")
              }
            }}
          />
        ) : null}
        {effectiveApplyRunId ? (
          <RunLogTail
            runId={effectiveApplyRunId}
            onDone={(status) => {
              if (status === "succeeded") {
                setFinalizeState("succeeded")
                setFinalizeError(null)
              } else if (status === "failed" || status === "canceled") {
                setFinalizeState("failed")
                setFinalizeError("Apply updates failed")
              }
            }}
          />
        ) : null}
      </div>
    </SettingsSection>
  )
}
