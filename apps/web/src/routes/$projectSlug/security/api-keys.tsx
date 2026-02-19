import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { ProjectTokenKeyringCard } from "~/components/setup/project-token-keyring-card"
import { useProjectBySlug } from "~/lib/project-data"

export const Route = createFileRoute("/$projectSlug/security/api-keys")({
  component: SecurityApiKeys,
})

function SecurityApiKeys() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const credentialsQuery = useQuery({
    ...convexQuery(
      api.controlPlane.projectCredentials.listByProject,
      projectId ? { projectId: projectId as Id<"projects"> } : "skip",
    ),
  })
  const credentials = credentialsQuery.data ?? []
  const bySection = new Map(credentials.map((row) => [row.section, row]))
  const hcloud = bySection.get("hcloudKeyring")?.metadata
  const tailscale = bySection.get("tailscaleKeyring")?.metadata
  const github = bySection.get("githubToken")?.metadata

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectQuery.projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Project credentials</h2>
        <p className="text-sm text-muted-foreground">
          Operator tokens and deploy tooling settings used across the project.
        </p>
      </div>

      <ProjectTokenKeyringCard
        projectId={projectQuery.projectId as Id<"projects">}
        kind="hcloud"
        setupHref={`/${projectSlug}/runner`}
        title="Hetzner API keys"
        description="Project-wide keyring. Add multiple tokens and select the active one."
        statusSummary={{
          hasActive: hcloud?.hasActive === true,
          itemCount: Number(hcloud?.itemCount || 0),
          items: hcloud?.items ?? [],
        }}
        onQueued={() => {
          void credentialsQuery.refetch()
        }}
      />

      <ProjectTokenKeyringCard
        projectId={projectQuery.projectId as Id<"projects">}
        kind="tailscale"
        setupHref={`/${projectSlug}/runner`}
        title="Tailscale API keys"
        description="Project-wide keyring used by setup and tailnet bootstrap."
        statusSummary={{
          hasActive: tailscale?.hasActive === true,
          itemCount: Number(tailscale?.itemCount || 0),
          items: tailscale?.items ?? [],
        }}
        onQueued={() => {
          void credentialsQuery.refetch()
        }}
      />

      <DeployCredsCard
        projectId={projectQuery.projectId as Id<"projects">}
        setupHref={`/${projectSlug}/runner`}
        visibleKeys={["GITHUB_TOKEN"]}
        statusSummary={{
          GITHUB_TOKEN: {
            status: github?.status === "set" ? "set" : "unset",
          },
        }}
        onQueued={() => {
          void credentialsQuery.refetch()
        }}
      />
    </div>
  )
}
