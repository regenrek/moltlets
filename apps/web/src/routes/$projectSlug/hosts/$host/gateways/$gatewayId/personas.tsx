import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import type { Id } from "../../../../../../../convex/_generated/dataModel"
import { api } from "../../../../../../../convex/_generated/api"
import { GatewayPersonas } from "~/components/fleet/gateway/gateway-personas"
import { authClient } from "~/lib/auth-client"
import { useProjectBySlug } from "~/lib/project-data"

export const Route = createFileRoute("/$projectSlug/hosts/$host/gateways/$gatewayId/personas")({
  component: GatewayPersonasRoute,
})

function GatewayPersonasRoute() {
  const { projectSlug, host, gatewayId } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const project = useQuery({
    ...convexQuery(api.controlPlane.projects.get, projectId && canQuery ? { projectId } : "skip"),
    gcTime: 5_000,
    enabled: Boolean(projectId) && canQuery,
  })
  const canEdit = project.data?.role === "admin"

  const gatewaysQuerySpec = convexQuery(
    api.controlPlane.gateways.listByProjectHost,
    projectId && canQuery
      ? {
          projectId,
          hostName: host,
        }
      : "skip",
  )
  const gatewaysQuery = useQuery({
    ...gatewaysQuerySpec,
    enabled: Boolean(projectId) && canQuery,
    gcTime: 5_000,
  })

  const gatewaySummary = gatewaysQuery.data?.find((row) => row.gatewayId === gatewayId)
  const personaIds = (gatewaySummary?.desired?.personaIds || [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
  const agentsCfg = { list: personaIds.map((id) => ({ id })) }

  if (projectQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (projectQuery.error) return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  if (!projectId) return <div className="text-muted-foreground">Project not found.</div>
  if (gatewaysQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (gatewaysQuery.error) return <div className="text-sm text-destructive">{String(gatewaysQuery.error)}</div>
  if (!gatewaySummary) return <div className="text-muted-foreground">Gateway not found in control-plane metadata.</div>

  return (
    <GatewayPersonas
      projectId={projectId}
      host={host}
      gatewayId={gatewayId}
      agents={agentsCfg}
      canEdit={canEdit}
      metadataQueryKey={gatewaysQuerySpec.queryKey}
    />
  )
}
