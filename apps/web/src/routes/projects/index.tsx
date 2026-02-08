import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useProjectCreateModal } from "~/components/projects/project-create-modal-provider"
import { Button } from "~/components/ui/button"
import { ProjectsTable } from "~/components/dashboard/projects-table"
import { dashboardOverviewQueryOptions } from "~/lib/query-options"
import { slugifyProjectName, storeLastProjectSlug } from "~/lib/project-routing"

export const Route = createFileRoute("/projects/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(dashboardOverviewQueryOptions())
  },
  component: ProjectsIndex,
})

function ProjectsIndex() {
  const router = useRouter()
  const { openProjectCreateModal } = useProjectCreateModal()
  const overview = useSuspenseQuery(dashboardOverviewQueryOptions())
  const projects = overview.data?.projects ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Local infra repos managed by Clawlets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/projects/import" />}
          >
            Import
          </Button>
          <Button onClick={openProjectCreateModal}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New
          </Button>
        </div>
      </div>

      {projects.length > 0 ? (
        <ProjectsTable
          projects={projects}
          selectedProjectId={null}
          onSelectProjectId={(projectId) => {
            const selected = projects.find((project) => project.projectId === projectId)
            if (!selected) return
            const projectSlug = slugifyProjectName(selected.name)
            storeLastProjectSlug(projectSlug)
            void router.navigate({
              to: "/$projectSlug",
              params: { projectSlug },
            })
          }}
        />
      ) : (
        <div className="border rounded-lg p-6 bg-card">
          <div className="font-medium">No projects yet</div>
          <div className="text-muted-foreground text-sm mt-1">
            Create your first project to configure and deploy a fleet.
          </div>
          <div className="mt-4">
            <Button onClick={openProjectCreateModal}>
              Create Project
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
