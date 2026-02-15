import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { deriveSetupModel, type SetupModel, type SetupStepId } from "~/lib/setup/setup-model"
import { deriveRepoHealth } from "~/lib/setup/repo-health"
import { setupConfigProbeQueryOptions, type SetupConfig } from "~/lib/setup/repo-probe"
import { getDeployCredsStatus } from "~/sdk/infra"
import { setupDraftGet } from "~/sdk/setup"
import { SECRETS_VERIFY_BOOTSTRAP_RUN_KIND } from "~/sdk/secrets/run-kind"

export type SetupSearch = {
  step?: string
}

type PendingNonSecretDraft = {
  infrastructure?: {
    serverType?: string
    image?: string
    location?: string
    allowTailscaleUdpIngress?: boolean
  }
  connection?: {
    adminCidr?: string
    sshExposureMode?: "bootstrap" | "tailnet" | "public"
    sshKeyCount?: number
    sshAuthorizedKeys?: string[]
  }
}

type PendingBootstrapSecrets = {
  tailscaleAuthKey?: string
  useTailscaleLockdown?: boolean
}

const DEPLOY_CREDS_SUMMARY_STALE_MS = 60_000

export function useSetupModel(params: {
  projectSlug: string
  host: string
  search: SetupSearch
  pendingNonSecretDraft?: PendingNonSecretDraft | null
  pendingBootstrapSecrets?: PendingBootstrapSecrets | null
}) {
  const router = useRouter()
  const projectQuery = useProjectBySlug(params.projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"
  const isCreating = projectStatus === "creating"
  const isError = projectStatus === "error"

  const runnersQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runners.listByProject,
      projectId && (isReady || isCreating) ? { projectId } : "skip",
    ),
  })
  const runners = runnersQuery.data ?? []
  const runnerOnline = React.useMemo(
    () => isProjectRunnerOnline(runners),
    [runners],
  )

  const sealedRunners = React.useMemo(
    () =>
      runners
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
    [runners],
  )

  const [selectedRunnerId, setSelectedRunnerId] = React.useState<string>("")
  React.useEffect(() => {
    if (sealedRunners.length === 1) {
      setSelectedRunnerId(String(sealedRunners[0]?._id || ""))
      return
    }
    if (!sealedRunners.some((runner) => String(runner._id) === selectedRunnerId)) {
      setSelectedRunnerId("")
    }
  }, [sealedRunners, selectedRunnerId])

  const targetRunner = React.useMemo(() => {
    if (sealedRunners.length === 1) return sealedRunners[0] ?? null
    return sealedRunners.find((runner) => String(runner._id) === selectedRunnerId) ?? null
  }, [sealedRunners, selectedRunnerId])

  const projectConfigsQuery = useQuery({
    ...convexQuery(
      api.controlPlane.projectConfigs.listByProject,
      projectId && isReady && runnerOnline ? { projectId } : "skip",
    ),
  })
  const setupConfigQuery = useQuery({
    ...setupConfigProbeQueryOptions(projectId),
    enabled: Boolean(projectId && isReady && runnerOnline),
  })
  const config: SetupConfig | null = setupConfigQuery.data ?? null

  const setupDraftQuery = useQuery({
    queryKey: ["setupDraft", projectId, params.host],
    queryFn: async () => {
      if (!projectId) throw new Error("missing project id")
      return await setupDraftGet({ data: { projectId, host: params.host } })
    },
    enabled: Boolean(projectId && isReady && params.host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const setupDraft = setupDraftQuery.data ?? null

  const repoHealth = deriveRepoHealth({
    runnerOnline,
    projectStatus,
    configs: projectConfigsQuery.data ?? [],
  })
  const repoProbeState = repoHealth.state
  const repoProbeOk = repoProbeState === "ok"
  const repoProbeError = repoProbeState === "error" ? repoHealth.error : null

  const latestBootstrapRunQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runs.latestByProjectHostKind,
      projectId && params.host
        ? {
            projectId,
            host: params.host,
            kind: "bootstrap",
          }
        : "skip",
    ),
  })

  const latestBootstrapSecretsVerifyRunQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runs.latestByProjectHostKind,
      projectId && params.host
        ? {
            projectId,
            host: params.host,
            kind: SECRETS_VERIFY_BOOTSTRAP_RUN_KIND,
          }
        : "skip",
    ),
  })

  const deployCredsSummary = targetRunner?.deployCredsSummary ?? null
  const targetRunnerId = targetRunner ? String(targetRunner._id) : ""
  const deployCredsSummaryStale = React.useMemo(() => {
    const updatedAtMs = Number(deployCredsSummary?.updatedAtMs || 0)
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return true
    return Date.now() - updatedAtMs > DEPLOY_CREDS_SUMMARY_STALE_MS
  }, [deployCredsSummary?.updatedAtMs])

  const deployCredsFallbackQuery = useQuery({
    queryKey: ["deployCredsFallback", projectId, targetRunnerId],
    queryFn: async () => {
      if (!projectId) throw new Error("missing project id")
      if (!targetRunnerId) throw new Error("missing target runner id")
      return await getDeployCredsStatus({
        data: {
          projectId,
          targetRunnerId,
        },
      })
    },
    enabled: Boolean(projectId && isReady && runnerOnline && targetRunnerId && deployCredsSummaryStale),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const fallbackProjectTokenKeyrings = deployCredsFallbackQuery.data?.projectTokenKeyrings
  const effectiveProjectTokenKeyrings = !deployCredsSummaryStale && deployCredsSummary?.projectTokenKeyrings
    ? deployCredsSummary.projectTokenKeyrings
    : fallbackProjectTokenKeyrings ?? deployCredsSummary?.projectTokenKeyrings

  const fallbackHasGithubToken = React.useMemo(
    () => deployCredsFallbackQuery.data?.keys?.some((row) => row.key === "GITHUB_TOKEN" && row.status === "set") === true,
    [deployCredsFallbackQuery.data?.keys],
  )

  const hasActiveHcloudToken = React.useMemo(
    () => effectiveProjectTokenKeyrings?.hcloud?.hasActive === true,
    [effectiveProjectTokenKeyrings?.hcloud?.hasActive],
  )
  const hasActiveTailscaleAuthKey = React.useMemo(
    () => effectiveProjectTokenKeyrings?.tailscale?.hasActive === true,
    [effectiveProjectTokenKeyrings?.tailscale?.hasActive],
  )
  const hasProjectGithubToken = React.useMemo(
    () => {
      if (!deployCredsSummaryStale) return deployCredsSummary?.hasGithubToken === true
      return fallbackHasGithubToken || deployCredsSummary?.hasGithubToken === true
    },
    [deployCredsSummary?.hasGithubToken, deployCredsSummaryStale, fallbackHasGithubToken],
  )

  const projectInitRunsPageQuery = useQuery({
    ...convexQuery(
      api.controlPlane.runs.listByProjectPage,
      projectId && isError
        ? {
            projectId,
            paginationOpts: { numItems: 50, cursor: null as string | null },
          }
        : "skip",
    ),
  })

  const model: SetupModel = React.useMemo(
    () =>
      deriveSetupModel({
        config,
        hostFromRoute: params.host,
        stepFromSearch: params.search.step,
        setupDraft,
        pendingNonSecretDraft: params.pendingNonSecretDraft ?? null,
        hasActiveHcloudToken,
        hasProjectGithubToken,
        hasActiveTailscaleAuthKey,
        pendingTailscaleAuthKey: params.pendingBootstrapSecrets?.tailscaleAuthKey,
        useTailscaleLockdown: params.pendingBootstrapSecrets?.useTailscaleLockdown,
        latestBootstrapRun: latestBootstrapRunQuery.data ?? null,
        latestBootstrapSecretsVerifyRun: latestBootstrapSecretsVerifyRunQuery.data ?? null,
      }),
    [
      config,
      setupDraft,
      params.pendingNonSecretDraft,
      hasActiveHcloudToken,
      hasProjectGithubToken,
      hasActiveTailscaleAuthKey,
      params.pendingBootstrapSecrets?.tailscaleAuthKey,
      params.pendingBootstrapSecrets?.useTailscaleLockdown,
      latestBootstrapRunQuery.data,
      latestBootstrapSecretsVerifyRunQuery.data,
      params.host,
      params.search.step,
    ],
  )

  const setSearch = React.useCallback(
    (next: Partial<SetupSearch>, opts?: { replace?: boolean }) => {
      void router.navigate({
        to: "/$projectSlug/hosts/$host/setup",
        params: { projectSlug: params.projectSlug, host: params.host },
        search: (prev: SetupSearch) => ({ ...prev, ...next }),
        replace: opts?.replace,
      })
    },
    [params.host, params.projectSlug, router],
  )

  const setStep = React.useCallback(
    (stepId: SetupStepId) => {
      setSearch({ step: stepId })
    },
    [setSearch],
  )

  const advance = React.useCallback(() => {
    const visible = model.steps.filter((step) => step.status !== "locked")
    const currentIndex = visible.findIndex((step) => step.id === model.activeStepId)
    const next = visible.slice(currentIndex + 1).find((step) => step.status !== "locked")?.id
    if (next) setStep(next)
  }, [model.activeStepId, model.steps, setStep])

  return {
    projectQuery,
    projectId,
    projectStatus,
    isReady,
    runnersQuery,
    runners,
    runnerOnline,
    sealedRunners,
    selectedRunnerId,
    setSelectedRunnerId,
    targetRunner,
    deployCredsSummary,
    deployCredsSummaryStale,
    config,
    repoProbeOk,
    repoProbeState,
    repoProbeError,
    setupDraftQuery,
    setupDraft,
    latestBootstrapRunQuery,
    latestBootstrapSecretsVerifyRunQuery,
    projectInitRunsPageQuery,
    model,
    selectedHost: model.selectedHost,
    hasActiveHcloudToken,
    hasProjectGithubToken,
    hasActiveTailscaleAuthKey,
    setStep,
    advance,
  }
}
