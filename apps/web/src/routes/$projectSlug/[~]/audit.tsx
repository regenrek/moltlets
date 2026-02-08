import { convexQuery } from "@convex-dev/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HostScopeChooser } from "~/components/host-scope-chooser"
import { projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/~/audit")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
    await context.queryClient.ensureQueryData(convexQuery(api.controlPlane.hosts.listByProject, { projectId }))
  },
  component: AuditChooser,
})

function AuditChooser() {
  const { projectSlug } = Route.useParams()
  return (
    <HostScopeChooser
      projectSlug={projectSlug}
      title="Audit"
      description="Select a host to review audit logs."
      buildHref={(host) => `${buildHostPath(projectSlug, host)}/audit`}
    />
  )
}
