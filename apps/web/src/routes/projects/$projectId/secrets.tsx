import { createFileRoute } from "@tanstack/react-router"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import type { Id } from "../../../../convex/_generated/dataModel"

export const Route = createFileRoute("/projects/$projectId/secrets")({
  component: ProjectSecrets,
})

function ProjectSecrets() {
  const { projectId } = Route.useParams()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Secrets</h1>
        <p className="text-muted-foreground">
          Project-wide credentials and operator settings.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">Project credentials</h2>
          <p className="text-sm text-muted-foreground">
            Operator tokens and deploy tooling settings used across the project.
          </p>
        </div>
        <DeployCredsCard projectId={projectId as Id<"projects">} />
      </div>
    </div>
  )
}
