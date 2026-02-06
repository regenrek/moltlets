import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { clawletsConfigQueryOptions, deployCredsQueryOptions } from "~/lib/query-options"
import { coerceSetupStepId, deriveSetupModel, type SetupModel, type SetupStepId } from "~/lib/setup/setup-model"

export type SetupSearch = {
  host?: string
  step?: string
}

export function useSetupModel(params: { projectSlug: string; search: SetupSearch }) {
  const router = useRouter()
  const projectQuery = useProjectBySlug(params.projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"

  const configQuery = useQuery({
    ...clawletsConfigQueryOptions(projectId),
    enabled: Boolean(projectId && isReady),
  })
  const config = (configQuery.data?.config as any) ?? null

  const deployCredsQuery = useQuery({
    ...deployCredsQueryOptions(projectId),
    enabled: Boolean(projectId && isReady),
  })
  const deployCreds = (deployCredsQuery.data as any) ?? null

  const preModel = React.useMemo(
    () =>
      deriveSetupModel({
        config,
        hostFromSearch: params.search.host,
        stepFromSearch: params.search.step,
        deployCreds,
        latestBootstrapRun: null,
        latestSecretsVerifyRun: null,
      }),
    [config, deployCreds, params.search.host, params.search.step],
  )

  const selectedHost = preModel.selectedHost

  const latestBootstrapRunQuery = useQuery({
    ...convexQuery(api.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: selectedHost || "",
      kind: "bootstrap",
    }),
    enabled: Boolean(projectId && selectedHost),
  })

  const latestSecretsVerifyRunQuery = useQuery({
    ...convexQuery(api.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: selectedHost || "",
      kind: "secrets_verify",
    }),
    enabled: Boolean(projectId && selectedHost),
  })

  const model: SetupModel = React.useMemo(
    () =>
      deriveSetupModel({
        config,
        hostFromSearch: params.search.host,
        stepFromSearch: params.search.step,
        deployCreds,
        latestBootstrapRun: (latestBootstrapRunQuery.data as any) ?? null,
        latestSecretsVerifyRun: (latestSecretsVerifyRunQuery.data as any) ?? null,
      }),
    [
      config,
      deployCreds,
      latestBootstrapRunQuery.data,
      latestSecretsVerifyRunQuery.data,
      params.search.host,
      params.search.step,
    ],
  )

  const setSearch = React.useCallback(
    (next: Partial<SetupSearch>, opts?: { replace?: boolean }) => {
      void router.navigate({
        to: "/$projectSlug/setup",
        params: { projectSlug: params.projectSlug },
        search: (prev: Record<string, unknown>) => ({ ...prev, ...next }),
        replace: opts?.replace,
      } as any)
    },
    [params.projectSlug, router],
  )

  const setSelectedHost = React.useCallback(
    (host: string) => {
      const nextHost = host.trim()
      if (!nextHost) return
      setSearch({ host: nextHost })
    },
    [setSearch],
  )

  const setStep = React.useCallback(
    (stepId: SetupStepId) => {
      setSearch({ step: stepId })
    },
    [setSearch],
  )

  const advance = React.useCallback(() => {
    const visible = model.steps.filter((s) => s.status !== "locked")
    const currentIdx = visible.findIndex((s) => s.id === model.activeStepId)
    const next = visible.slice(currentIdx + 1).find((s) => s.status !== "locked")?.id
    if (next) setStep(next)
  }, [model.activeStepId, model.steps, setStep])

  React.useEffect(() => {
    const desiredHost = model.selectedHost || undefined
    const hostNeedsFix = desiredHost && params.search.host !== desiredHost
    const requested = coerceSetupStepId(params.search.step)
    const stepNeedsFix = !requested
    if (hostNeedsFix || stepNeedsFix) {
      setSearch({ ...(hostNeedsFix ? { host: desiredHost } : {}), ...(stepNeedsFix ? { step: model.activeStepId } : {}) }, { replace: true })
    }
  }, [model.activeStepId, model.selectedHost, params.search.host, params.search.step, setSearch])

  return {
    projectQuery,
    projectId,
    projectStatus,
    isReady,
    configQuery,
    config,
    deployCredsQuery,
    deployCreds,
    latestBootstrapRunQuery,
    latestSecretsVerifyRunQuery,
    model,
    selectedHost: model.selectedHost,
    setSelectedHost,
    setStep,
    advance,
  }
}
