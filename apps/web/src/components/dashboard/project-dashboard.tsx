import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouter } from "@tanstack/react-router"
import * as React from "react"
import { useConvexAuth } from "convex/react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ProjectOverviewReady } from "~/components/dashboard/project-overview-ready"
import type { RunRow } from "~/components/dashboard/recent-runs-table"
import { Button } from "~/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"
import { authClient } from "~/lib/auth-client"
import { dashboardOverviewQueryOptions } from "~/lib/query-options"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"

type ProjectHostRow = (typeof api.controlPlane.hosts.listByProject)["_returnType"][number]

export function ProjectDashboard(props: {
  projectId: Id<"projects">
  projectSlug: string
}) {
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const hasServerHttpClient = Boolean(convexQueryClient.serverHttpClient)
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const overview = useQuery({
    ...dashboardOverviewQueryOptions(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    enabled: canQuery,
  })
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, { projectId: props.projectId }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    enabled: canQuery,
  })
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    enabled: canQuery,
  })

  const project = React.useMemo(() => {
    return overview.data?.projects.find((p) => p.projectId === props.projectId) ?? null
  }, [overview.data?.projects, props.projectId])

  const hostRows = (hostsQuery.data ?? []) as ProjectHostRow[]
  const hostNames = React.useMemo(() => hostRows.map((row) => row.hostName), [hostRows])
  const hasHosts = hostRows.length > 0

  const recentRuns = useQuery({
    queryKey: ["dashboardRecentRuns", project?.projectId ?? null, hasServerHttpClient],
    enabled: Boolean(project?.projectId) && canQuery && hasHosts,
    queryFn: async () => {
      const args = {
        projectId: project!.projectId as Id<"projects">,
        paginationOpts: { numItems: 50, cursor: null as string | null },
      }
      if (hasServerHttpClient) {
        return await convexQueryClient.serverHttpClient!.consistentQuery(api.controlPlane.runs.listByProjectPage, args)
      }
      return await convexQueryClient.convexClient.query(api.controlPlane.runs.listByProjectPage, args)
    },
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  })

  const projectAccess = useQuery({
    ...convexQuery(api.controlPlane.projects.get, {
      projectId: props.projectId,
    }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    enabled: canQuery,
  })

  const runners = runnersQuery.data ?? []
  const runnerOnline = React.useMemo(() => isProjectRunnerOnline(runners), [runners])
  const canWrite = projectAccess.data?.role === "admin"
  const runs = hasHosts ? ((recentRuns.data?.page ?? []) as RunRow[]) : []

  if (!canQuery) {
    return <div className="text-muted-foreground">Loading…</div>
  }

  if (overview.isPending || hostsQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }

  if (overview.error) {
    return <div className="text-sm text-destructive">{String(overview.error)}</div>
  }

  if (hostsQuery.error) {
    return <div className="text-sm text-destructive">{String(hostsQuery.error)}</div>
  }

  if (!project) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Project not found</CardTitle>
          <CardDescription>Pick a different project from the list.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            nativeButton={false}
            render={<Link to="/projects" />}
          >
            Back to projects
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <ProjectOverviewReady
      projectId={props.projectId}
      projectSlug={props.projectSlug}
      project={project}
      hostRows={hostRows}
      hostNames={hostNames}
      runnerOnline={runnerOnline}
      isCheckingRunner={runnersQuery.isPending}
      runs={runs}
      canWrite={canWrite}
    />
  )
}
