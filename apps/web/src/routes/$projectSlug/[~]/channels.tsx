import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { listPinnedChannelUiModels } from "@clawlets/core/lib/openclaw/channel-ui-metadata"
import { EntityRow, type EntityStatusTone } from "~/components/entity-row"
import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { PageHeader } from "~/components/ui/page-header"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"

type ChannelRow = {
  host: string
  gatewayId: string
  channelId: string
  channelName: string
  accountLabel: string | null
  statusLabel: string
  statusTone: EntityStatusTone
}

function collectChannelRows(gateways: (typeof api.controlPlane.gateways.listByProject)["_returnType"]): ChannelRow[] {
  const channelModelById = new Map(listPinnedChannelUiModels().map((model) => [model.id, model] as const))
  const rows: ChannelRow[] = []
  for (const gateway of gateways) {
    const desired = (gateway.desired || {}) as { channels?: string[]; enabled?: boolean }
    const channelIds = Array.isArray(desired.channels)
      ? Array.from(new Set(desired.channels.map((entry) => String(entry || "").trim()).filter(Boolean))).toSorted()
      : []
    for (const channelId of channelIds) {
      const model = channelModelById.get(channelId)
      const channelName = model?.name || channelId
      const enabled = desired.enabled !== false
      rows.push({
        host: gateway.hostName,
        gatewayId: gateway.gatewayId,
        channelId,
        channelName,
        accountLabel: null,
        statusLabel: enabled ? "enabled" : "disabled",
        statusTone: enabled ? "positive" : "neutral",
      })
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
    await context.queryClient.ensureQueryData(convexQuery(api.controlPlane.gateways.listByProject, { projectId }))
  },
  component: ChannelsAggregate,
})

function ChannelsAggregate() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"

  const gatewaysQuery = useQuery({
    ...convexQuery(api.controlPlane.gateways.listByProject, { projectId: projectId as Id<"projects"> }),
    enabled: Boolean(projectId && isReady),
  })

  const rows = useMemo(() => collectChannelRows(gatewaysQuery.data || []), [gatewaysQuery.data])

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

      {gatewaysQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : gatewaysQuery.error ? (
        <div className="text-sm text-destructive">{String(gatewaysQuery.error)}</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground">No channel metadata yet.</div>
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
              subtitle={row.accountLabel || "Metadata-only summary"}
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
