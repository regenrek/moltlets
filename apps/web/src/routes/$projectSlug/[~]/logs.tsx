import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HostScopeChooser } from "~/components/host-scope-chooser"
import { clawletsConfigQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/~/logs")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
    await context.queryClient.ensureQueryData(clawletsConfigQueryOptions(projectId))
  },
  component: LogsChooser,
})

function LogsChooser() {
  const { projectSlug } = Route.useParams()
  return (
    <HostScopeChooser
      projectSlug={projectSlug}
      title="Server Logs"
      description="Choose a host to view server logs."
      buildHref={(host) => `${buildHostPath(projectSlug, host)}/logs`}
    />
  )
}
