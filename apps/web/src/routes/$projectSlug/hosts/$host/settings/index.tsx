import { useQuery } from "@tanstack/react-query"
import { Link, createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { HostSettingsForm } from "~/components/hosts/host-settings-form"
import { Button } from "~/components/ui/button"
import { useProjectBySlug } from "~/lib/project-data"
import { configDotGet } from "~/sdk/config"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export const Route = createFileRoute("/$projectSlug/hosts/$host/settings/")({
  component: HostSettingsGeneralPage,
})

function HostSettingsGeneralPage() {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Host Settings</h1>
        <p className="text-muted-foreground">
          Manage hosts, SSH targets, and access settings.
        </p>
      </div>

      {projectQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : projectQuery.error ? (
        <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
      ) : !projectId ? (
        <div className="text-muted-foreground">Project not found.</div>
      ) : hostConfigQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : hostConfigQuery.error ? (
        <div className="text-sm text-destructive">{String(hostConfigQuery.error)}</div>
      ) : hostCfg ? (
        <HostSettingsForm
          key={`${selectedHost}:${hostConfigQuery.dataUpdatedAt}`}
          projectId={projectId}
          projectSlug={projectSlug}
          selectedHost={selectedHost}
          hostCfg={hostCfg}
          hostConfigQueryKey={hostConfigQueryKey}
        />
      ) : (
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
      )}
    </div>
  )
}
