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
import { parseProjectTokenKeyring, resolveActiveProjectTokenEntry } from "~/lib/project-token-keyring"
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

  const deployCredsQuery = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("missing project id")
      return await getDeployCredsStatus({ data: { projectId } })
    },
    enabled: Boolean(projectId && isReady && runnerOnline),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const deployCredsByKey = React.useMemo(() => {
    const out: Record<string, { status?: "set" | "unset"; value?: string }> = {}
    for (const row of deployCredsQuery.data?.keys || []) out[row.key] = row
    return out
  }, [deployCredsQuery.data?.keys])

  const hasActiveHcloudToken = React.useMemo(() => {
    const keyring = parseProjectTokenKeyring(deployCredsByKey["HCLOUD_TOKEN_KEYRING"]?.value)
    const activeId = String(deployCredsByKey["HCLOUD_TOKEN_KEYRING_ACTIVE"]?.value || "").trim()
    const activeEntry = resolveActiveProjectTokenEntry({ keyring, activeId })
    return Boolean(activeEntry?.value?.trim())
  }, [deployCredsByKey])

  const activeTailscaleAuthKey = React.useMemo(() => {
    const keyring = parseProjectTokenKeyring(deployCredsByKey["TAILSCALE_AUTH_KEY_KEYRING"]?.value)
    const activeId = String(deployCredsByKey["TAILSCALE_AUTH_KEY_KEYRING_ACTIVE"]?.value || "").trim()
    const activeEntry = resolveActiveProjectTokenEntry({ keyring, activeId })
    return activeEntry?.value || ""
  }, [deployCredsByKey])

  const hasActiveTailscaleAuthKey = React.useMemo(
    () => activeTailscaleAuthKey.trim().length > 0,
    [activeTailscaleAuthKey],
  )
  const hasProjectGithubToken = React.useMemo(
    () => deployCredsByKey["GITHUB_TOKEN"]?.status === "set",
    [deployCredsByKey],
  )
  const hasProjectSopsAgeKeyPath = React.useMemo(
    () => String(deployCredsByKey["SOPS_AGE_KEY_FILE"]?.value || "").trim().length > 0,
    [deployCredsByKey],
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
        hasProjectSopsAgeKeyPath,
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
      hasProjectSopsAgeKeyPath,
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
    hasProjectSopsAgeKeyPath,
    hasActiveTailscaleAuthKey,
    activeTailscaleAuthKey,
    setStep,
    advance,
  }
}
