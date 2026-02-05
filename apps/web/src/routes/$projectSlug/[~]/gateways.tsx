import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { EntityRow } from "~/components/entity-row"
import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { PageHeader } from "~/components/ui/page-header"
import { useProjectBySlug } from "~/lib/project-data"
import { clawletsConfigQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"
import { formatChannelsLabel, getGatewayChannels } from "~/components/fleet/gateway/gateway-roster"
import type { GatewayArchitecture } from "@clawlets/core/lib/clawlets-config"

type GatewayRow = {
  host: string
  gatewayId: string
  channels: string[]
  personas: number
  enabled: boolean
}

function listGatewaysForHost(hostCfg: any): string[] {
  const ordered = Array.isArray(hostCfg?.gatewaysOrder) ? hostCfg.gatewaysOrder.map(String) : []
  const defined = hostCfg?.gateways && typeof hostCfg.gateways === "object" ? Object.keys(hostCfg.gateways) : []
  const extras = defined.filter((id) => !ordered.includes(id)).sort()
  return [...ordered, ...extras].filter(Boolean)
}

function collectGatewayRows(config: any): GatewayRow[] {
  const hosts = (Object.entries(config?.hosts ?? {}) as Array<[string, any]>).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  const rows: GatewayRow[] = []
  for (const [host, hostCfg] of hosts) {
    const gateways = listGatewaysForHost(hostCfg)
    for (const gatewayId of gateways) {
      const gatewayCfg = (hostCfg as any)?.gateways?.[gatewayId] || {}
      const personas = Array.isArray(gatewayCfg?.agents?.list) ? gatewayCfg.agents.list.length : 0
      rows.push({
        host,
        gatewayId,
        channels: getGatewayChannels({ config, host, gatewayId }),
        personas,
        enabled: hostCfg?.enable !== false,
      })
    }
  }
  return rows
}

function formatArchitectureLabel(architecture?: GatewayArchitecture): string {
  if (!architecture) return "—"
  return architecture === "single" ? "single" : "multi"
}

export const Route = createFileRoute("/$projectSlug/~/gateways")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
    await context.queryClient.ensureQueryData(clawletsConfigQueryOptions(projectId))
  },
  component: GatewaysAggregate,
})

function GatewaysAggregate() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"

  const cfg = useQuery({
    ...clawletsConfigQueryOptions(projectId as Id<"projects"> | null),
    enabled: Boolean(projectId && isReady),
  })

  const config = cfg.data?.config as any
  const gatewayArchitecture = (config?.fleet as { gatewayArchitecture?: GatewayArchitecture } | undefined)?.gatewayArchitecture
  const rows = useMemo(() => (config ? collectGatewayRows(config) : []), [config])

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
      <PageHeader
        title="Gateways"
        description="Aggregated OpenClaw gateways across the fleet."
      />

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground">No gateways configured yet.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const channelsLabel = formatChannelsLabel(row.channels)
            return (
              <EntityRow
                key={`${row.host}:${row.gatewayId}`}
                href={`${buildHostPath(projectSlug, row.host)}/gateways/${encodeURIComponent(row.gatewayId)}/overview`}
                leading={
                  <Avatar size="sm">
                    <AvatarFallback>{row.gatewayId.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                }
                title={row.gatewayId}
                subtitle={row.host}
                status={{
                  label: row.enabled ? "enabled" : "disabled",
                  tone: row.enabled ? "positive" : "neutral",
                }}
                columns={[
                  { label: "Architecture", value: formatArchitectureLabel(gatewayArchitecture) },
                  { label: "Personas", value: String(row.personas) },
                  { label: "Channels", value: channelsLabel },
                ]}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
