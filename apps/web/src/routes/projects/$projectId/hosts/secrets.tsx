import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { HostSecretsPanel } from "~/components/secrets/host-secrets-panel"

export const Route = createFileRoute("/projects/$projectId/hosts/secrets")({
  component: HostSecrets,
})

function HostSecrets() {
  const { projectId } = Route.useParams()

  return (
    <div className="space-y-6">
      <HostSecretsPanel projectId={projectId as Id<"projects">} />
    </div>
  )
}
