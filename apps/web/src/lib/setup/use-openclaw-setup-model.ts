import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import {
  coerceOpenClawSetupStepId,
  deriveOpenClawSetupModel,
  type OpenClawSetupModel,
  type OpenClawSetupStepId,
} from "~/lib/setup/openclaw-setup-model"
import { configDotGet } from "~/sdk/config"
import { SECRETS_VERIFY_OPENCLAW_RUN_KIND } from "~/sdk/secrets/run-kind"

export type OpenClawSetupSearch = {
  step?: string
}

export function useOpenClawSetupModel(params: { projectSlug: string; host: string; search: OpenClawSetupSearch }) {
  const router = useRouter()
  const projectQuery = useProjectBySlug(params.projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"

  const configQuery = useQuery({
    queryKey: ["openclawSetupConfig", projectId, params.host],
    enabled: Boolean(projectId && isReady && params.host),
    queryFn: async () => {
      const hostNode = await configDotGet({
        data: {
          projectId: projectId as Id<"projects">,
          path: `hosts.${params.host}`,
        },
      })
      const hostCfg =
        hostNode.value && typeof hostNode.value === "object" && !Array.isArray(hostNode.value)
          ? (hostNode.value as Record<string, unknown>)
          : null
      return { hosts: hostCfg ? { [params.host]: hostCfg } : {} }
    },
  })
  const config = (configQuery.data as any) ?? null

  const latestOpenClawSecretsVerifyRunQuery = useQuery({
    ...convexQuery(api.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: params.host,
      kind: SECRETS_VERIFY_OPENCLAW_RUN_KIND,
    }),
    enabled: Boolean(projectId && params.host),
  })

  const latestUpdateApplyRunQuery = useQuery({
    ...convexQuery(api.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: params.host,
      kind: "server_update_apply",
    }),
    enabled: Boolean(projectId && params.host),
  })

  const model: OpenClawSetupModel = React.useMemo(
    () =>
      deriveOpenClawSetupModel({
        config,
        hostFromRoute: params.host,
        stepFromSearch: params.search.step,
        latestOpenClawSecretsVerifyRun: (latestOpenClawSecretsVerifyRunQuery.data as any) ?? null,
        latestUpdateApplyRun: (latestUpdateApplyRunQuery.data as any) ?? null,
      }),
    [
      config,
      latestOpenClawSecretsVerifyRunQuery.data,
      latestUpdateApplyRunQuery.data,
      params.host,
      params.search.step,
    ],
  )

  const setSearch = React.useCallback(
    (next: Partial<OpenClawSetupSearch>, opts?: { replace?: boolean }) => {
      void router.navigate({
        to: "/$projectSlug/hosts/$host/openclaw-setup",
        params: { projectSlug: params.projectSlug, host: params.host },
        search: (prev: Record<string, unknown>) => ({ ...prev, ...next }),
        replace: opts?.replace,
      } as any)
    },
    [params.host, params.projectSlug, router],
  )

  const setStep = React.useCallback(
    (stepId: OpenClawSetupStepId) => {
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
    const requested = coerceOpenClawSetupStepId(params.search.step)
    if (!requested) {
      setSearch({ step: model.activeStepId }, { replace: true })
    }
  }, [model.activeStepId, params.search.step, setSearch])

  return {
    projectQuery,
    projectId,
    projectStatus,
    isReady,
    configQuery,
    config,
    latestOpenClawSecretsVerifyRunQuery,
    latestUpdateApplyRunQuery,
    model,
    selectedHost: model.selectedHost,
    setStep,
    advance,
  }
}
