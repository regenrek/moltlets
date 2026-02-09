import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import * as React from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { useProjectBySlug } from "~/lib/project-data"
import { deployCredsQueryOptions } from "~/lib/query-options"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { coerceSetupStepId, deriveSetupModel, type SetupModel, type SetupStepId } from "~/lib/setup/setup-model"
import type { DeployCredsStatus } from "~/sdk/infra"
import { configDotGet } from "~/sdk/config/dot-get"
import { SECRETS_VERIFY_BOOTSTRAP_RUN_KIND } from "~/sdk/secrets/run-kind"

export type SetupSearch = {
  step?: string
}

export type RepoProbeState = "idle" | "checking" | "ok" | "error"

type SetupConfig = {
  hosts: Record<string, Record<string, unknown>>
  fleet: {
    sshAuthorizedKeys: unknown[]
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
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
  const isCreating = projectStatus === "creating"
  const isError = projectStatus === "error"

  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, {
      projectId: projectId as Id<"projects">,
    }),
    enabled: Boolean(projectId && (isReady || isCreating)),
  })
  const runners = runnersQuery.data ?? []
  const runnerOnline = React.useMemo(
    () => isProjectRunnerOnline(runners),
    [runners],
  )

  const configQuery = useQuery({
    queryKey: ["hostSetupConfig", projectId, params.host],
    enabled: Boolean(projectId && isReady && params.host && runnerOnline),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const [hostNode, sshKeysNode] = await withTimeout(
        Promise.all([
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
        ]),
        35_000,
        "Repo probe timed out while checking config access. Ensure runner is idle and retry.",
      )
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
    enabled: Boolean(projectId && isReady && runnerOnline),
  })
  const deployCreds: DeployCredsStatus | null = deployCredsQuery.data ?? null

  const repoProbeOk = runnerOnline && configQuery.isSuccess
  const repoProbeState: RepoProbeState = !runnerOnline
    ? "idle"
    : configQuery.isPending
      ? "checking"
      : configQuery.isSuccess
        ? "ok"
        : configQuery.isError
          ? "error"
          : "checking"
  const repoProbeError = repoProbeState === "error" ? configQuery.error : null

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

  const projectInitRunsPageQuery = useQuery({
    ...convexQuery(api.controlPlane.runs.listByProjectPage, {
      projectId: projectId as Id<"projects">,
      paginationOpts: { numItems: 50, cursor: null as string | null },
    }),
    enabled: Boolean(projectId && isError),
  })

  const model: SetupModel = React.useMemo(
    () =>
      deriveSetupModel({
        runnerOnline,
        repoProbeOk,
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
      repoProbeOk,
      runnerOnline,
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
