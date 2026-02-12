import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { deployCredsQueryOptions } from "~/lib/query-options"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { deriveSetupModel, type SetupModel, type SetupStepId } from "~/lib/setup/setup-model"
import { deriveRepoProbeState, setupConfigProbeQueryOptions, type RepoProbeState } from "~/lib/setup/repo-probe"
import type { DeployCredsStatus } from "~/sdk/infra"
import { SECRETS_VERIFY_BOOTSTRAP_RUN_KIND } from "~/sdk/secrets/run-kind"

export type SetupSearch = {
  step?: string
}

export function useSetupModel(params: { projectSlug: string; host: string; search: SetupSearch }) {
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

  const deployCredsQuery = useQuery({
    ...deployCredsQueryOptions(projectId),
    enabled: Boolean(projectId && isReady && runnerOnline),
  })
  const deployCreds: DeployCredsStatus | null = deployCredsQuery.data ?? null

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
        deployCreds,
        latestBootstrapRun: latestBootstrapRunQuery.data ?? null,
        latestBootstrapSecretsVerifyRun: latestBootstrapSecretsVerifyRunQuery.data ?? null,
      }),
    [
      config,
      deployCreds,
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
    deployCredsQuery,
    deployCreds,
    latestBootstrapRunQuery,
    latestBootstrapSecretsVerifyRunQuery,
    projectInitRunsPageQuery,
    model,
    selectedHost: model.selectedHost,
    setStep,
    advance,
  }
}
