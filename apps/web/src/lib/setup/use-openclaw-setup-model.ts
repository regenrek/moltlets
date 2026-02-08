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

type OpenClawSetupConfig = {
  hosts: Record<string, Record<string, unknown>>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function decodeOpenClawSetupConfig(params: { host: string; hostValue: unknown }): OpenClawSetupConfig {
  const hostCfg = asRecord(params.hostValue)
  return {
    hosts: hostCfg ? { [params.host]: hostCfg } : {},
  }
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
      return decodeOpenClawSetupConfig({
        host: params.host,
        hostValue: hostNode.value,
      })
    },
  })
  const config = configQuery.data ?? null

  const latestOpenClawSecretsVerifyRunQuery = useQuery({
    ...convexQuery(api.controlPlane.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: params.host,
      kind: SECRETS_VERIFY_OPENCLAW_RUN_KIND,
    }),
    enabled: Boolean(projectId && params.host),
  })

  const latestUpdateApplyRunQuery = useQuery({
    ...convexQuery(api.controlPlane.runs.latestByProjectHostKind, {
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
        latestOpenClawSecretsVerifyRun: latestOpenClawSecretsVerifyRunQuery.data ?? null,
        latestUpdateApplyRun: latestUpdateApplyRunQuery.data ?? null,
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
        search: (prev: OpenClawSetupSearch) => ({ ...prev, ...next }),
        replace: opts?.replace,
      })
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
    const visible = model.steps.filter((step) => step.status !== "locked")
    const currentIndex = visible.findIndex((step) => step.id === model.activeStepId)
    const next = visible.slice(currentIndex + 1).find((step) => step.status !== "locked")?.id
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
