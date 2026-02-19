import { convexQuery } from "@convex-dev/react-query"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { deriveSetupModel, type SetupModel } from "~/lib/setup/setup-model"
import { deriveRepoHealth } from "~/lib/setup/repo-health"
import { setupConfigProbeQueryOptions, type SetupConfig } from "~/lib/setup/repo-probe"
import { getHostInfraStatus } from "~/sdk/host"
import { setupDraftGet } from "~/sdk/setup"
import { SECRETS_VERIFY_BOOTSTRAP_RUN_KIND } from "~/sdk/secrets/run-kind"

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
  useTailscaleLockdown?: boolean
}

const DEPLOY_CREDS_RECONCILE_DELAYS_MS = [0, 800, 2_000, 5_000] as const

export function useSetupModel(params: {
  projectSlug: string
  host: string
  pendingNonSecretDraft?: PendingNonSecretDraft | null
  pendingBootstrapSecrets?: PendingBootstrapSecrets | null
}) {
  const queryClient = useQueryClient()
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

  const infraStatusQuery = useQuery({
    queryKey: ["hostInfraStatus", projectId, params.host],
    queryFn: async () => {
      if (!projectId) throw new Error("missing projectId")
      if (!params.host) throw new Error("missing host")
      return await getHostInfraStatus({ data: { projectId, host: params.host } })
    },
    enabled: Boolean(projectId && runnerOnline && params.host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
  })
  const infraExists = React.useMemo(
    () => (infraStatusQuery.data?.ok ? infraStatusQuery.data.exists : undefined),
    [infraStatusQuery.data],
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

  const projectCredentialsQuery = useQuery({
    ...convexQuery(
      api.controlPlane.projectCredentials.listByProject,
      projectId ? { projectId } : "skip",
    ),
  })
  const projectCredentials = projectCredentialsQuery.data ?? []

  const projectCredentialBySection = React.useMemo(() => {
    const out = new Map<string, (typeof projectCredentials)[number]>()
    for (const row of projectCredentials) {
      if (typeof row?.section === "string" && row.section) out.set(row.section, row)
    }
    return out
  }, [projectCredentials])

  const credentialSectionSet = React.useCallback((section: string): boolean => {
    const row = projectCredentialBySection.get(section)
    if (!row) return false
    if (row.metadata?.status === "set") return true
    if (row.metadata?.status === "unset") return false
    return row.syncStatus === "pending"
  }, [projectCredentialBySection])

  const credentialSectionStringValue = React.useCallback((section: string): string => {
    const row = projectCredentialBySection.get(section)
    const items = Array.isArray(row?.metadata?.stringItems) ? row.metadata.stringItems : []
    const first = String(items[0] || "").trim()
    return first
  }, [projectCredentialBySection])

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
  const deployCredsRefreshTimeoutsRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([])
  const clearDeployCredsRefreshTimeouts = React.useCallback(() => {
    for (const timeout of deployCredsRefreshTimeoutsRef.current) clearTimeout(timeout)
    deployCredsRefreshTimeoutsRef.current = []
  }, [])
  const refreshDeployCredsStatus = React.useCallback(() => {
    clearDeployCredsRefreshTimeouts()
    for (const delayMs of DEPLOY_CREDS_RECONCILE_DELAYS_MS) {
      const timeout = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["setupDraft", projectId, params.host],
        })
        void runnersQuery.refetch()
      }, delayMs)
      deployCredsRefreshTimeoutsRef.current.push(timeout)
    }
  }, [clearDeployCredsRefreshTimeouts, params.host, projectId, queryClient, runnersQuery])
  React.useEffect(() => {
    return () => {
      clearDeployCredsRefreshTimeouts()
    }
  }, [clearDeployCredsRefreshTimeouts])
  React.useEffect(() => {
    clearDeployCredsRefreshTimeouts()
  }, [clearDeployCredsRefreshTimeouts, targetRunnerId])
  const hasActiveHcloudToken = React.useMemo(
    () => deployCredsSummary?.projectTokenKeyrings?.hcloud?.hasActive === true,
    [deployCredsSummary?.projectTokenKeyrings?.hcloud?.hasActive],
  )
  const secretWiringQuery = useQuery({
    ...convexQuery(
      api.controlPlane.secretWiring.listByProjectHost,
      projectId && params.host ? { projectId, hostName: params.host } : "skip",
    ),
    enabled: Boolean(projectId && params.host),
  })
  const hasHostTailscaleAuthKey = React.useMemo(
    () =>
      (secretWiringQuery.data ?? []).some(
        (row) => row.secretName === "tailscale_auth_key" && row.status === "configured",
      ),
    [secretWiringQuery.data],
  )
  const hasProjectGithubToken = React.useMemo(
    () =>
      deployCredsSummary?.hasGithubToken === true
      || credentialSectionSet("githubToken"),
    [credentialSectionSet, deployCredsSummary?.hasGithubToken],
  )
  const hasProjectGithubTokenAccess = React.useMemo(
    () =>
      deployCredsSummary?.hasGithubTokenAccess === false
        ? false
        : deployCredsSummary?.hasGithubTokenAccess === true || (deployCredsSummary?.hasGithubToken !== true
          ? credentialSectionSet("githubToken")
          : true),
    [
      credentialSectionSet,
      deployCredsSummary?.hasGithubToken,
      deployCredsSummary?.hasGithubTokenAccess,
    ],
  )
  const githubTokenAccessMessage = React.useMemo(
    () => String(deployCredsSummary?.githubTokenAccessMessage || "").trim(),
    [deployCredsSummary?.githubTokenAccessMessage],
  )
  const hasProjectGitRemoteOrigin = React.useMemo(
    () =>
      Boolean(deployCredsSummary?.hasGitRemoteOrigin)
      || credentialSectionSet("gitRemoteOrigin"),
    [credentialSectionSet, deployCredsSummary?.hasGitRemoteOrigin],
  )
  const projectGitRemoteOrigin = React.useMemo(
    () => String(deployCredsSummary?.gitRemoteOrigin || "").trim() || credentialSectionStringValue("gitRemoteOrigin"),
    [credentialSectionStringValue, deployCredsSummary?.gitRemoteOrigin],
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
        setupDraft,
        pendingNonSecretDraft: params.pendingNonSecretDraft ?? null,
        hasActiveHcloudToken,
        hasProjectGithubToken,
        hasProjectGithubTokenAccess,
        hasProjectGitRemoteOrigin,
        hasHostTailscaleAuthKey,
        useTailscaleLockdown: params.pendingBootstrapSecrets?.useTailscaleLockdown,
        latestBootstrapRun: latestBootstrapRunQuery.data ?? null,
        latestBootstrapSecretsVerifyRun: latestBootstrapSecretsVerifyRunQuery.data ?? null,
        infraExists,
      }),
    [
      config,
      setupDraft,
      params.pendingNonSecretDraft,
      hasActiveHcloudToken,
      hasProjectGithubToken,
      hasProjectGitRemoteOrigin,
      hasHostTailscaleAuthKey,
      params.pendingBootstrapSecrets?.useTailscaleLockdown,
      latestBootstrapRunQuery.data,
      latestBootstrapSecretsVerifyRunQuery.data,
      hasProjectGithubTokenAccess,
      params.host,
      infraExists,
    ],
  )

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
    projectGitRemoteOrigin,
    hasProjectGithubToken,
    hasProjectGithubTokenAccess,
    githubTokenAccessMessage,
    hasProjectGitRemoteOrigin,
    hasHostTailscaleAuthKey,
    refreshDeployCredsStatus,
  }
}
