import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { HostSettingsVpnPanel } from "~/components/hosts/host-settings-vpn-panel"
import { Button } from "~/components/ui/button"
import { useProjectBySlug } from "~/lib/project-data"
import { configDotGet } from "~/sdk/config"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export const Route = createFileRoute("/$projectSlug/hosts/$host/settings/vpn")({
  component: HostSettingsVpnPage,
})

function HostSettingsVpnPage() {
  const { projectSlug, host: selectedHost } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const hostConfigQueryKey = ["hostSettingsConfig", projectId, selectedHost] as const
  const hostConfigQuery = useQuery({
    queryKey: hostConfigQueryKey,
    queryFn: async () =>
      await configDotGet({
        data: { projectId: projectId as Id<"projects">, path: `hosts.${selectedHost}` },
      }),
    enabled: Boolean(projectId),
  })

  const hostCfg = asRecord(hostConfigQuery.data?.value)

  if (projectQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (projectQuery.error) return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  if (!projectId) return <div className="text-muted-foreground">Project not found.</div>
  if (hostConfigQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (hostConfigQuery.error) return <div className="text-sm text-destructive">{String(hostConfigQuery.error)}</div>

  if (!hostCfg) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium">Unknown host: {selectedHost}</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Add it in the fleet config or go back to hosts.
          </div>
        </div>
        <Button
          variant="secondary"
          nativeButton={false}
          render={<Link to="/$projectSlug/hosts" params={{ projectSlug }} />}
        >
          Back to hosts
        </Button>
      </div>
    )
  }

  return (
    <HostSettingsVpnPanel
      projectId={projectId}
      projectSlug={projectSlug}
      host={selectedHost}
      hostCfg={hostCfg}
      hostConfigQueryKey={hostConfigQueryKey}
    />
  )
}
