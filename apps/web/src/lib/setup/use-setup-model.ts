import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { deriveSetupModel, type SetupModel, type SetupStepId } from "~/lib/setup/setup-model"
import { deriveRepoProbeState, setupConfigProbeQueryOptions, type RepoProbeState } from "~/lib/setup/repo-probe"
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

  const configQuery = useQuery({
    ...setupConfigProbeQueryOptions(projectId),
    enabled: Boolean(projectId && isReady && runnerOnline),
  })
  const config = configQuery.data ?? null

  const hasConfig = Boolean(configQuery.data)
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

  const repoProbeOk = runnerOnline && hasConfig
  const repoProbeState: RepoProbeState = deriveRepoProbeState({
    runnerOnline,
    hasConfig,
    hasError: configQuery.isError,
  })
  const repoProbeError = repoProbeState === "error" ? configQuery.error : null

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

  const tailscaleSecretWiringQuery = useQuery({
    ...convexQuery(
      api.controlPlane.secretWiring.listByProjectHost,
      projectId && params.host
        ? {
            projectId,
            hostName: params.host,
          }
        : "skip",
    ),
  })
  const hasTailscaleAuthKeyConfigured = React.useMemo(() => {
    for (const row of tailscaleSecretWiringQuery.data ?? []) {
      if (row?.status === "configured" && String(row.secretName || "").trim() === "tailscale_auth_key") return true
    }
    return false
  }, [tailscaleSecretWiringQuery.data])

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
        hasTailscaleAuthKey: hasTailscaleAuthKeyConfigured,
        pendingTailscaleAuthKey: params.pendingBootstrapSecrets?.tailscaleAuthKey,
        useTailscaleLockdown: params.pendingBootstrapSecrets?.useTailscaleLockdown,
        latestBootstrapRun: latestBootstrapRunQuery.data ?? null,
        latestBootstrapSecretsVerifyRun: latestBootstrapSecretsVerifyRunQuery.data ?? null,
      }),
    [
      config,
      setupDraft,
      params.pendingNonSecretDraft,
      hasTailscaleAuthKeyConfigured,
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
    configQuery,
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
    hasTailscaleAuthKeyConfigured,
    setStep,
    advance,
  }
}
