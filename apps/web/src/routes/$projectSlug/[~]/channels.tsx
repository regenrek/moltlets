import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { listPinnedChannelUiModels } from "@clawlets/core/lib/openclaw/channel-ui-metadata"
import { EntityRow, type EntityStatusTone } from "~/components/entity-row"
import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { PageHeader } from "~/components/ui/page-header"
import { useProjectBySlug } from "~/lib/project-data"
import { clawletsConfigQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"
import { getGatewayChannels } from "~/components/fleet/gateway/gateway-roster"

type ChannelRow = {
  host: string
  gatewayId: string
  channelId: string
  channelName: string
  accountLabel: string | null
  statusLabel: string
  statusTone: EntityStatusTone
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function listGatewaysForHost(hostCfg: any): string[] {
  const ordered = Array.isArray(hostCfg?.gatewaysOrder) ? hostCfg.gatewaysOrder.map(String) : []
  const defined = hostCfg?.gateways && typeof hostCfg.gateways === "object" ? Object.keys(hostCfg.gateways) : []
  const extras = defined.filter((id) => !ordered.includes(id)).sort()
  return [...ordered, ...extras].filter(Boolean)
}

function getChannelConfig(gatewayCfg: any, channelId: string): Record<string, unknown> | null {
  const typed = isPlainObject(gatewayCfg?.channels) ? (gatewayCfg.channels as Record<string, unknown>) : null
  const openclaw = isPlainObject(gatewayCfg?.openclaw?.channels)
    ? (gatewayCfg.openclaw.channels as Record<string, unknown>)
    : null
  const typedEntry = typed && isPlainObject(typed[channelId]) ? (typed[channelId] as Record<string, unknown>) : null
  const openclawEntry = openclaw && isPlainObject(openclaw[channelId]) ? (openclaw[channelId] as Record<string, unknown>) : null
  return typedEntry ?? openclawEntry
}

function deriveChannelStatus(channelCfg: Record<string, unknown> | null): { label: string; tone: EntityStatusTone } {
  if (channelCfg && typeof channelCfg.enabled === "boolean") {
    return channelCfg.enabled
      ? { label: "enabled", tone: "positive" }
      : { label: "disabled", tone: "neutral" }
  }
  return { label: "configured", tone: "neutral" }
}

function pickChannelAccountLabel(channelCfg: Record<string, unknown> | null): string | null {
  if (!channelCfg) return null
  const candidates = [
    "account",
    "accountId",
    "guildId",
    "workspace",
    "team",
    "server",
    "serverId",
    "channel",
    "channelId",
    "tenant",
    "org",
    "organization",
    "domain",
    "url",
    "name",
    "handle",
    "username",
  ]
  for (const key of candidates) {
    const value = channelCfg[key]
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed && trimmed.length <= 80) return trimmed
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

function collectChannelRows(config: any): ChannelRow[] {
  const channelModelById = new Map(listPinnedChannelUiModels().map((model) => [model.id, model] as const))
  const hosts = Object.entries(config?.hosts ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const rows: ChannelRow[] = []
  for (const [host, hostCfg] of hosts) {
    const gateways = listGatewaysForHost(hostCfg)
    for (const gatewayId of gateways) {
      const gatewayCfg = (hostCfg as any)?.gateways?.[gatewayId] || {}
      const channelIds = getGatewayChannels({ config, host, gatewayId })
      for (const channelId of channelIds) {
        const model = channelModelById.get(channelId)
        const channelName = model?.name || channelId
        const channelCfg = getChannelConfig(gatewayCfg, channelId)
        const accountLabel = pickChannelAccountLabel(channelCfg)
        const status = deriveChannelStatus(channelCfg)
        rows.push({
          host,
          gatewayId,
          channelId,
          channelName,
          accountLabel,
          statusLabel: status.label,
          statusTone: status.tone,
        })
      }
    }
  }
  return rows
}

export const Route = createFileRoute("/$projectSlug/~/channels")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
    await context.queryClient.ensureQueryData(clawletsConfigQueryOptions(projectId))
  },
  component: ChannelsAggregate,
})

function ChannelsAggregate() {
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
  const rows = useMemo(() => (config ? collectChannelRows(config) : []), [config])

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
        title="Channels"
        description="Aggregated channel configuration across gateways."
      />

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground">No channels configured yet.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <EntityRow
              key={`${row.host}:${row.gatewayId}:${row.channelId}`}
              href={`${buildHostPath(projectSlug, row.host)}/gateways/${encodeURIComponent(row.gatewayId)}/settings`}
              leading={
                <Avatar size="sm">
                  <AvatarFallback>{row.channelName.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
              }
              title={row.channelName}
              subtitle={row.accountLabel || "Account not configured"}
              status={{ label: row.statusLabel, tone: row.statusTone }}
              columns={[
                { label: "Host", value: row.host },
                { label: "Gateway", value: row.gatewayId },
              ]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
