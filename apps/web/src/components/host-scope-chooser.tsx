import { convexQuery } from "@convex-dev/react-query"
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { api } from "../../convex/_generated/api"
import { EntityRow } from "~/components/entity-row"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { HostThemeBadge } from "~/components/hosts/host-theme"
import { useProjectBySlug } from "~/lib/project-data"

type HostScopeChooserProps = {
  projectSlug: string
  title: string
  description?: React.ReactNode
  buildHref: (host: string) => string
  emptyText?: string
  searchPlaceholder?: string
}

function HostScopeChooser({
  projectSlug,
  title,
  description,
  buildHref,
  emptyText = "No hosts configured yet.",
  searchPlaceholder = "Search hosts...",
}: HostScopeChooserProps) {
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"
  const [query, setQuery] = useState("")

  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, projectId && isReady ? { projectId } : "skip"),
    gcTime: 5_000,
  })

  const hostRows = hostsQuery.data
  const hostByName = useMemo(
    () => new Map((hostRows ?? []).map((row) => [row.hostName, row] as const)),
    [hostRows],
  )
  const hosts = useMemo(() => (hostRows ?? []).map((row) => row.hostName).sort(), [hostRows])
  const normalizedQuery = query.trim().toLowerCase()
  const filteredHosts = useMemo(
    () => (normalizedQuery
      ? hosts.filter((host) => host.toLowerCase().includes(normalizedQuery))
      : hosts),
    [hosts, normalizedQuery],
  )

  if (projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (projectQuery.error) {
    return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (projectStatus === "creating") {
    return <div className="text-muted-foreground">Project setup in progress. Refresh after the run completes.</div>
  }
  if (projectStatus === "error") {
    return <div className="text-sm text-destructive">Project setup failed. Check Runs for details.</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {hostsQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : hostsQuery.error ? (
        <div className="text-sm text-destructive">{String(hostsQuery.error)}</div>
      ) : (hostRows ?? []).length === 0 ? (
        <div className="text-muted-foreground">No host metadata yet.</div>
      ) : (
        <div className="space-y-4">
          <div className="max-w-sm">
            <Label htmlFor="host-chooser-search" className="sr-only">
              Search hosts
            </Label>
            <div className="relative">
              <Input
                id="host-chooser-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          {filteredHosts.length === 0 ? (
            <div className="text-muted-foreground">{emptyText}</div>
          ) : (
            <div className="space-y-2">
              {filteredHosts.map((host) => {
                const row = hostByName.get(host)
                const desired = row?.desired
                const enabled = desired?.enabled !== false
                const updateRing = String(desired?.selfUpdateChannel || "prod")
                const targetHost = desired?.targetHost ? String(desired.targetHost) : ""
                const gatewayCount = typeof desired?.gatewayCount === "number" ? desired.gatewayCount : 0
                const theme = desired?.theme ? { color: desired.theme as any } : undefined

                return (
                  <EntityRow
                    key={host}
                    href={buildHref(host)}
                    leading={
                      <HostThemeBadge theme={theme} size="sm" />
                    }
                    title={host}
                    subtitle={targetHost ? `Target: ${targetHost}` : "Target host not set"}
                    status={{
                      label: enabled ? "enabled" : "disabled",
                      tone: enabled ? "positive" : "neutral",
                    }}
                    columns={[
                      { label: "Update ring", value: updateRing },
                      { label: "Gateways", value: String(gatewayCount) },
                    ]}
                    trailing={null}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { HostScopeChooser }
export type { HostScopeChooserProps }
