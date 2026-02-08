import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { deployCredsQueryOptions } from "~/lib/query-options"
import { coerceSetupStepId, deriveSetupModel, type SetupModel, type SetupStepId } from "~/lib/setup/setup-model"
import { configDotGet } from "~/sdk/config"
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

  const configQuery = useQuery({
    queryKey: ["hostSetupConfig", projectId, params.host],
    enabled: Boolean(projectId && isReady && params.host),
    queryFn: async () => {
      const [hostNode, sshKeysNode] = await Promise.all([
        configDotGet({
          data: {
            projectId: projectId as Id<"projects">,
            path: `hosts.${params.host}`,
          },
        }),
        configDotGet({
          data: {
            projectId: projectId as Id<"projects">,
            path: "fleet.sshAuthorizedKeys",
          },
        }),
      ])
      const hostCfg =
        hostNode.value && typeof hostNode.value === "object" && !Array.isArray(hostNode.value)
          ? (hostNode.value as Record<string, unknown>)
          : null
      const sshAuthorizedKeys = Array.isArray(sshKeysNode.value) ? sshKeysNode.value : []
      return {
        hosts: hostCfg ? { [params.host]: hostCfg } : {},
        fleet: { sshAuthorizedKeys },
      }
    },
  })
  const config = (configQuery.data as any) ?? null

  const deployCredsQuery = useQuery({
    ...deployCredsQueryOptions(projectId),
    enabled: Boolean(projectId && isReady),
  })
  const deployCreds = (deployCredsQuery.data as any) ?? null

  const latestBootstrapRunQuery = useQuery({
    ...convexQuery(api.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: params.host,
      kind: "bootstrap",
    }),
    enabled: Boolean(projectId && params.host),
  })

  const latestBootstrapSecretsVerifyRunQuery = useQuery({
    ...convexQuery(api.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: params.host,
      kind: SECRETS_VERIFY_BOOTSTRAP_RUN_KIND,
    }),
    enabled: Boolean(projectId && params.host),
  })

  const model: SetupModel = React.useMemo(
    () =>
      deriveSetupModel({
        config,
        hostFromRoute: params.host,
        stepFromSearch: params.search.step,
        deployCreds,
        latestBootstrapRun: (latestBootstrapRunQuery.data as any) ?? null,
        latestBootstrapSecretsVerifyRun: (latestBootstrapSecretsVerifyRunQuery.data as any) ?? null,
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
        search: (prev: Record<string, unknown>) => ({ ...prev, ...next }),
        replace: opts?.replace,
      } as any)
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
    const visible = model.steps.filter((s) => s.status !== "locked")
    const currentIdx = visible.findIndex((s) => s.id === model.activeStepId)
    const next = visible.slice(currentIdx + 1).find((s) => s.status !== "locked")?.id
    if (next) setStep(next)
  }, [model.activeStepId, model.steps, setStep])

  React.useEffect(() => {
    const requested = coerceSetupStepId(params.search.step)
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
    deployCredsQuery,
    deployCreds,
    latestBootstrapRunQuery,
    latestBootstrapSecretsVerifyRunQuery,
    model,
    selectedHost: model.selectedHost,
    setStep,
    advance,
  }
}
