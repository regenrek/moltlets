import { createFileRoute } from "@tanstack/react-router"
import { RunsList } from "~/components/runs/runs-list"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"

export const Route = createFileRoute("/$projectSlug/~/runs")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(projectsListQueryOptions())
  },
  component: RunsPage,
})

function RunsPage() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black tracking-tight">Runs</h1>
      <p className="text-muted-foreground">
        History of doctor/bootstrap/updates/etc with event logs.
      </p>

      <RunsList projectSlug={projectSlug} projectId={projectId} />
    </div>
  )
}
