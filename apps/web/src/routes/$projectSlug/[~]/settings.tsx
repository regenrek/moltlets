import { convexQuery } from "@convex-dev/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HostScopeChooser } from "~/components/host-scope-chooser"
import { projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/~/settings")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
    await context.queryClient.ensureQueryData(convexQuery(api.hosts.listByProject, { projectId }))
  },
  component: SettingsChooser,
})

function SettingsChooser() {
  const { projectSlug } = Route.useParams()
  return (
    <HostScopeChooser
      projectSlug={projectSlug}
      title="Settings"
      description="Pick a host to adjust infra settings."
      buildHref={(host) => `${buildHostPath(projectSlug, host)}/settings`}
    />
  )
}
