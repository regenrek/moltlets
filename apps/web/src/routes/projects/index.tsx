import { convexQuery } from "@convex-dev/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "~/components/ui/button"
import { api } from "../../../convex/_generated/api"

export const Route = createFileRoute("/projects/")({
  component: ProjectsIndex,
})

function ProjectsIndex() {
  const projects = useQuery({ ...convexQuery(api.projects.list, {}), gcTime: 5_000 })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Local infra repos managed by Clawdlets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" nativeButton={false} render={<Link to="/projects/import" />}>
            Import
          </Button>
          <Button nativeButton={false} render={<Link to="/projects/new" />}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New
          </Button>
        </div>
      </div>

      {projects.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : projects.data && projects.data.length > 0 ? (
        <div className="grid gap-3">
          {projects.data.map((p) => (
            <Link
              key={p._id}
              to="/projects/$projectId"
              params={{ projectId: p._id }}
              className="block rounded-lg border bg-card p-5 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-muted-foreground text-xs mt-1 truncate">
                    {p.localPath}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {p.status}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg p-6 bg-card">
          <div className="font-medium">No projects yet</div>
          <div className="text-muted-foreground text-sm mt-1">
            Create your first project to configure and deploy a fleet.
          </div>
          <div className="mt-4">
            <Button nativeButton={false} render={<Link to="/projects/new" />}>
              Create Project
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
