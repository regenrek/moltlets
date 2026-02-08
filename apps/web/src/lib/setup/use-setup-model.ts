import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { deployCredsQueryOptions } from "~/lib/query-options"
import { coerceSetupStepId, deriveSetupModel, type SetupModel, type SetupStepId } from "~/lib/setup/setup-model"
import type { DeployCredsStatus } from "~/sdk/infra"
import { configDotGet } from "~/sdk/config"
import { SECRETS_VERIFY_BOOTSTRAP_RUN_KIND } from "~/sdk/secrets/run-kind"

export type SetupSearch = {
  step?: string
}

type SetupConfig = {
  hosts: Record<string, Record<string, unknown>>
  fleet: {
    sshAuthorizedKeys: unknown[]
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function decodeSetupConfig(params: {
  host: string
  hostValue: unknown
  sshKeysValue: unknown
}): SetupConfig {
  const hostCfg = asRecord(params.hostValue)
  return {
    hosts: hostCfg ? { [params.host]: hostCfg } : {},
    fleet: {
      sshAuthorizedKeys: Array.isArray(params.sshKeysValue) ? params.sshKeysValue : [],
    },
  }
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
      return decodeSetupConfig({
        host: params.host,
        hostValue: hostNode.value,
        sshKeysValue: sshKeysNode.value,
      })
    },
  })
  const config = configQuery.data ?? null

  const deployCredsQuery = useQuery({
    ...deployCredsQueryOptions(projectId),
    enabled: Boolean(projectId && isReady),
  })
  const deployCreds: DeployCredsStatus | null = deployCredsQuery.data ?? null

  const latestBootstrapRunQuery = useQuery({
    ...convexQuery(api.controlPlane.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host: params.host,
      kind: "bootstrap",
    }),
    enabled: Boolean(projectId && params.host),
  })

  const latestBootstrapSecretsVerifyRunQuery = useQuery({
    ...convexQuery(api.controlPlane.runs.latestByProjectHostKind, {
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
