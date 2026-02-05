import { MagnifyingGlassIcon } from "@heroicons/react/24/outline"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { EntityRow } from "~/components/entity-row"
import { Badge } from "~/components/ui/badge"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { HostThemeBadge } from "~/components/hosts/host-theme"
import { useProjectBySlug } from "~/lib/project-data"
import { clawletsConfigQueryOptions } from "~/lib/query-options"

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

  const cfg = useQuery({
    ...clawletsConfigQueryOptions(projectId as Id<"projects"> | null),
    enabled: Boolean(projectId && isReady),
  })

  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])
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

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
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
                const hostCfg = (config?.hosts as any)?.[host] || {}
                const enabled = hostCfg?.enable !== false
                const updateRing = String(hostCfg?.selfUpdate?.channel || "prod")
                const targetHost = hostCfg?.targetHost ? String(hostCfg.targetHost) : ""
                const gatewaysOrder = Array.isArray(hostCfg?.gatewaysOrder) ? hostCfg.gatewaysOrder : []
                const gatewayIds = Object.keys(hostCfg?.gateways || {})
                const gatewayCount = new Set([...gatewaysOrder, ...gatewayIds]).size
                const isDefault = config?.defaultHost === host

                return (
                  <EntityRow
                    key={host}
                    href={buildHref(host)}
                    leading={
                      <HostThemeBadge theme={hostCfg?.theme} size="sm" />
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
                    trailing={
                      isDefault ? (
                        <Badge variant="secondary">default</Badge>
                      ) : null
                    }
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
