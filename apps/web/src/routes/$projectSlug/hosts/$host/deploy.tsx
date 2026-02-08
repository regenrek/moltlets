import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import { DeployApplyChanges } from "~/components/deploy/deploy-apply"
import { DeployInitialInstall } from "~/components/deploy/deploy-initial"
import { Button } from "~/components/ui/button"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/hosts/$host/deploy")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
  },
  component: DeployHost,
})

function DeployHost() {
  const { projectSlug, host } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status

  const bootstrapRun = useQuery({
    ...convexQuery(api.controlPlane.runs.latestByProjectHostKind, {
      projectId: projectId as Id<"projects">,
      host,
      kind: "bootstrap",
    }),
    enabled: Boolean(projectId && host),
  })

  const hasBootstrapped = bootstrapRun.data?.status === "succeeded"

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (projectStatus === "creating") {
    return <div className="text-muted-foreground">Project setup in progress. Refresh after the run completes.</div>
  }
  if (projectStatus === "error") {
    return <div className="text-sm text-destructive">Project setup failed. Check Runs for details.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Deploy</h1>
          <p className="text-muted-foreground">
            {hasBootstrapped ? "Apply changes." : "Initial install (bootstrap)."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/$projectSlug/hosts/$host/setup" params={{ projectSlug, host }} />}
          >
            Open Setup
          </Button>
        </div>
      </div>

      {bootstrapRun.isPending ? (
        <div className="text-muted-foreground">Loading deploy state…</div>
      ) : bootstrapRun.error ? (
        <div className="text-sm text-destructive">{String(bootstrapRun.error)}</div>
      ) : hasBootstrapped ? (
        <DeployApplyChanges projectSlug={projectSlug} host={host} />
      ) : (
        <DeployInitialInstall projectSlug={projectSlug} host={host} />
      )}
    </div>
  )
}
