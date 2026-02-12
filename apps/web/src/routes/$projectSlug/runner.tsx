import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { SetupStepRunner } from "~/components/setup/steps/step-runner"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"
import { deriveRepoProbeState, setupConfigProbeQueryOptions } from "~/lib/setup/repo-probe"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { slugifyProjectName } from "~/lib/project-routing"
import { projectRetryInit } from "~/sdk/project"
import { toast } from "sonner"

type ProjectHostRow = (typeof api.controlPlane.hosts.listByProject)["_returnType"][number]

function normalizeHostName(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized.length > 0 ? normalized : null
}

function pickSetupHost(hostRows: ProjectHostRow[], preferredHost?: string | null): string | null {
  const preferred = normalizeHostName(preferredHost)
  if (preferred && hostRows.some((row) => row.hostName === preferred)) {
    return preferred
  }
  const sorted = [...hostRows].sort((a, b) => String(a.hostName).localeCompare(String(b.hostName)))
  return normalizeHostName(sorted[0]?.hostName)
}

export const Route = createFileRoute("/$projectSlug/runner")({
  loader: async ({ context, params }) => {
    const projects = (await context.queryClient.ensureQueryData(projectsListQueryOptions())) as Array<any>
    const project = projects.find((item) => slugifyProjectName(String(item?.name || "")) === params.projectSlug) || null
    if (project?.status === "ready" && project?._id) {
      const hostRows = (await context.queryClient.ensureQueryData(
        convexQuery(api.controlPlane.hosts.listByProject, { projectId: project._id as Id<"projects"> }),
      )) as ProjectHostRow[]
      const setupHost = pickSetupHost(hostRows)
      if (!setupHost) return
      throw redirect({
        to: "/$projectSlug/hosts/$host/setup",
        params: { projectSlug: params.projectSlug, host: setupHost },
        search: { step: "infrastructure" },
      })
    }
  },
  component: ProjectRunnerOnboarding,
})

function ProjectRunnerOnboarding() {
  const { projectSlug } = Route.useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status

  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, {
      projectId: projectId as Id<"projects">,
    }),
    enabled: Boolean(projectId),
  })
  const hostRows = hostsQuery.data ?? []

  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, {
      projectId: projectId as Id<"projects">,
    }),
    enabled: Boolean(projectId),
  })
  const runners = runnersQuery.data ?? []
  const runnerOnline = isProjectRunnerOnline(runners)

  const configQuery = useQuery({
    ...setupConfigProbeQueryOptions(projectId),
    enabled: Boolean(projectId && runnerOnline),
  })
  const repoProbeState = deriveRepoProbeState({
    runnerOnline,
    hasConfig: Boolean(configQuery.data),
    hasError: configQuery.isError,
  })

  const runsQuery = useQuery({
    ...convexQuery(api.controlPlane.runs.listByProjectPage, {
      projectId: projectId as Id<"projects">,
      paginationOpts: { numItems: 50, cursor: null as string | null },
    }),
    enabled: Boolean(projectId && (projectStatus === "creating" || projectStatus === "error")),
  })
  const latestProjectInitRun = (runsQuery.data as any)?.page?.find?.((run: any) => run?.kind === "project_init") ?? null

  const latestProjectInitHost = normalizeHostName(latestProjectInitRun?.host)
  const setupHost = pickSetupHost(hostRows, latestProjectInitHost)
  const retryProjectInit = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("project not found")
      if (!setupHost) throw new Error("project init retry requires a host")
      return await projectRetryInit({
        data: {
          projectId: projectId as Id<"projects">,
          host: setupHost,
        },
      })
    },
    onSuccess: () => {
      toast.success("Project init retry queued")
      void queryClient.invalidateQueries({ queryKey: projectsListQueryOptions().queryKey })
      void runsQuery.refetch()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  useEffect(() => {
    if (projectStatus !== "ready") return
    if (hostsQuery.isPending) return
    if (!setupHost) return
    void router.navigate({
      to: "/$projectSlug/hosts/$host/setup",
      params: { projectSlug, host: setupHost },
      search: { step: "infrastructure" },
    })
  }, [hostsQuery.isPending, projectSlug, projectStatus, router, setupHost])

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (hostsQuery.error) {
    return <div className="text-sm text-destructive">{String(hostsQuery.error)}</div>
  }
  if (projectStatus === "ready" && hostsQuery.isPending) {
    return <div className="text-muted-foreground">Project ready. Resolving setup host…</div>
  }
  if (projectStatus === "ready") {
    if (!setupHost) {
      return <div className="text-sm text-destructive">Project ready but no hosts found for setup redirect.</div>
    }
    return <div className="text-muted-foreground">Project ready. Redirecting…</div>
  }

  const latestInitError = String(latestProjectInitRun?.errorMessage || "").trim()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-black tracking-tight">Runner setup</h1>
        <p className="text-muted-foreground text-sm">
          Connect a project runner to initialize git workspace and project files.
        </p>
      </div>

      <SetupStepRunner
        projectId={projectId as Id<"projects">}
        projectRunnerRepoPath={(projectQuery.project as any)?.runnerRepoPath ?? null}
        runnerOnline={runnerOnline}
        repoProbeOk={repoProbeState === "ok"}
        repoProbeState={repoProbeState}
        repoProbeError={configQuery.error}
        runners={(runners as any[]).map((runner: any) => ({
          runnerName: String(runner.runnerName || ""),
          lastStatus: String(runner.lastStatus || "offline"),
          lastSeenAt: Number(runner.lastSeenAt || 0),
        }))}
      />

      {projectStatus === "creating" ? (
        <Alert>
          <AlertTitle>Project initialization in progress</AlertTitle>
          <AlertDescription>
            {latestProjectInitRun
              ? `Latest run status: ${String(latestProjectInitRun.status || "queued")}.`
              : "Project init run is queued. Waiting for runner to lease and complete."}
          </AlertDescription>
        </Alert>
      ) : null}

      {projectStatus === "error" ? (
        <div className="space-y-3">
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
            <AlertTitle>Project setup failed</AlertTitle>
            <AlertDescription>
              {latestInitError || "Project init failed. Check runs for details."}
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap items-center gap-2">
            <AsyncButton
              type="button"
              size="sm"
              pending={retryProjectInit.isPending}
              pendingText="Retrying..."
              disabled={!setupHost}
              onClick={() => retryProjectInit.mutate()}
            >
              Retry project init
            </AsyncButton>
            <Button
              type="button"
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/$projectSlug/runs" params={{ projectSlug }} />}
            >
              Open runs
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
