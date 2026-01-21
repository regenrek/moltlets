import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "~/components/ui/button"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"

export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectOverview,
})

function ProjectOverview() {
  const { projectId } = Route.useParams()
  const project = useQuery({
    ...convexQuery(api.projects.get, { projectId: projectId as Id<"projects"> }),
    gcTime: 5_000,
  })

  const p = project.data?.project

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight truncate">{p?.name || projectId}</h1>
          <p className="text-muted-foreground mt-1">Configure, validate, and operate this fleet.</p>
          {p ? (
            <div className="text-xs text-muted-foreground mt-2 truncate">
              {p.status} · {p.localPath}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6 space-y-2">
          <div className="font-medium">Setup</div>
          <div className="text-muted-foreground text-sm">
            Fleet config, hosts, bots, providers, secrets, doctor, bootstrap.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/projects/$projectId/setup/fleet" params={{ projectId }} />}
            >
              Fleet
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/projects/$projectId/setup/doctor" params={{ projectId }} />}
            >
              Doctor
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-2">
          <div className="font-medium">Operate</div>
          <div className="text-muted-foreground text-sm">
            Deploy, view logs, audit checks, restart units.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/projects/$projectId/operate/deploy" params={{ projectId }} />}
            >
              Deploy
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/projects/$projectId/runs" params={{ projectId }} />}
            >
              Runs
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
