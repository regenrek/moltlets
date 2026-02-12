import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { EntityRow } from "~/components/entity-row"
import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { PageHeader } from "~/components/ui/page-header"
import { useProjectBySlug } from "~/lib/project-data"
import { projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"
import { formatChannelsLabel } from "~/components/fleet/gateway/gateway-roster"

type GatewayRow = {
  host: string
  gatewayId: string
  channels: string[]
  personas: number
  enabled: boolean
  architecture?: string
}

function sortedUnique(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).toSorted()
}

function collectGatewayRows(params: {
  hosts: (typeof api.controlPlane.hosts.listByProject)["_returnType"]
  gateways: (typeof api.controlPlane.gateways.listByProject)["_returnType"]
}): GatewayRow[] {
  const hostByName = new Map(params.hosts.map((row) => [row.hostName, row] as const))
  return params.gateways.map((row) => {
    const host = hostByName.get(row.hostName)
    const desired = (row.desired ?? {}) as {
      channels?: string[]
      personaCount?: number
    }
    const hostDesired = (host?.desired ?? {}) as {
      enabled?: boolean
      gatewayArchitecture?: string
    }
    return {
      host: row.hostName,
      gatewayId: row.gatewayId,
      channels: sortedUnique(desired.channels),
      personas: typeof desired.personaCount === "number" ? desired.personaCount : 0,
      enabled: hostDesired.enabled !== false,
      architecture: hostDesired.gatewayArchitecture,
    }
  })
}

function formatArchitectureLabel(architecture?: string): string {
  if (!architecture) return "—"
  return architecture
}

export const Route = createFileRoute("/$projectSlug/~/gateways")({
  loader: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const project = projects.find((p) => slugifyProjectName(p.name) === params.projectSlug) ?? null
    const projectId = (project?._id as Id<"projects"> | null) ?? null
    if (!projectId) return
    if (project?.status !== "ready") return
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.controlPlane.hosts.listByProject, { projectId })),
      context.queryClient.ensureQueryData(convexQuery(api.controlPlane.gateways.listByProject, { projectId })),
    ])
  },
  component: GatewaysAggregate,
})

function GatewaysAggregate() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const projectStatus = projectQuery.project?.status
  const isReady = projectStatus === "ready"

  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, projectId && isReady ? { projectId } : "skip"),
    enabled: Boolean(projectId && isReady),
  })
  const gatewaysQuery = useQuery({
    ...convexQuery(api.controlPlane.gateways.listByProject, projectId && isReady ? { projectId } : "skip"),
    enabled: Boolean(projectId && isReady),
  })

  const rows = useMemo(
    () => collectGatewayRows({ hosts: hostsQuery.data || [], gateways: gatewaysQuery.data || [] }),
    [gatewaysQuery.data, hostsQuery.data],
  )
  const loading = hostsQuery.isPending || gatewaysQuery.isPending
  const error = hostsQuery.error || gatewaysQuery.error

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

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="text-sm text-destructive">{String(error)}</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground">No gateway metadata yet.</div>
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
                  { label: "Architecture", value: formatArchitectureLabel(row.architecture) },
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
