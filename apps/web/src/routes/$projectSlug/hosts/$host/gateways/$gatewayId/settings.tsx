import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import type { Id } from "../../../../../../../convex/_generated/dataModel"
import { api } from "../../../../../../../convex/_generated/api"
import { GatewayCapabilities } from "~/components/fleet/gateway/gateway-capabilities"
import { GatewayOpenclawEditor } from "~/components/fleet/gateway/gateway-openclaw-editor"
import { GatewayPersonas } from "~/components/fleet/gateway/gateway-personas"
import { GatewayIntegrations } from "~/components/fleet/integrations/gateway-integrations"
import { GatewayWorkspaceDocs } from "~/components/fleet/gateway/gateway-workspace-docs"
import { authClient } from "~/lib/auth-client"
import { useProjectBySlug } from "~/lib/project-data"
import { configDotGet } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/hosts/$host/gateways/$gatewayId/settings")({
  component: GatewaySettingsRoute,
})

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function buildAgentsFromPersonaIds(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {}
  const list = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((id) => ({ id }))
  if (list.length === 0) return {}
  return { list }
}

function buildChannelsFromNames(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {}
  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((name) => [name, { enabled: true }] as const)
  return Object.fromEntries(entries)
}

function GatewaySettingsRoute() {
  const { projectSlug, host, gatewayId } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const project = useQuery({
    ...convexQuery(api.controlPlane.projects.get, { projectId: projectId as Id<"projects"> }),
    gcTime: 5_000,
    enabled: Boolean(projectId) && canQuery,
  })
  const canEdit = project.data?.role === "admin"

  const hostsQueryOptions = convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> })
  const hosts = useQuery({
    ...hostsQueryOptions,
    gcTime: 5_000,
    enabled: Boolean(projectId) && canQuery,
  })

  const gatewaysQueryOptions = convexQuery(api.controlPlane.gateways.listByProjectHost, {
    projectId: projectId as Id<"projects">,
    hostName: host,
  })
  const gateways = useQuery({
    ...gatewaysQueryOptions,
    gcTime: 5_000,
    enabled: Boolean(projectId) && canQuery,
  })

  const gatewayConfigQueryKey = ["gatewaySettingsConfig", projectId, host, gatewayId] as const
  const gatewayConfig = useQuery({
    queryKey: gatewayConfigQueryKey,
    queryFn: async () =>
      await configDotGet({
        data: { projectId: projectId as Id<"projects">, path: `hosts.${host}.gateways.${gatewayId}` },
      }),
    enabled: Boolean(projectId) && canQuery,
  })

  const fleetSecretEnv = useQuery({
    queryKey: ["fleetSecretEnv", projectId] as const,
    queryFn: async () =>
      await configDotGet({
        data: { projectId: projectId as Id<"projects">, path: "fleet.secretEnv" },
      }),
    enabled: Boolean(projectId) && canQuery,
  })

  const hostMeta = hosts.data?.find((row) => row.hostName === host)
  const gatewayMeta = gateways.data?.find((row) => row.gatewayId === gatewayId)
  const gatewayCfg = asRecord(gatewayConfig.data?.value)
  const gatewayBase = gatewayCfg ?? {}
  const openclawCfg = asRecord(gatewayBase.openclaw) ?? {}
  const channelsCfg = asRecord(gatewayBase.channels) ?? buildChannelsFromNames(gatewayMeta?.desired?.channels)
  const agentsCfg = asRecord(gatewayBase.agents) ?? buildAgentsFromPersonaIds(gatewayMeta?.desired?.personaIds)
  const hooksCfg = asRecord(gatewayBase.hooks) ?? {}
  const skillsCfg = asRecord(gatewayBase.skills) ?? {}
  const pluginsCfg = asRecord(gatewayBase.plugins) ?? {}
  const profile = asRecord(gatewayBase.profile) ?? {}
  const fleetSecretEnvCfg = asRecord(fleetSecretEnv.data?.value) ?? {}

  if (projectQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (projectQuery.error) return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  if (!projectId) return <div className="text-muted-foreground">Project not found.</div>
  if (hosts.isPending || gateways.isPending || gatewayConfig.isPending || fleetSecretEnv.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (hosts.error) return <div className="text-sm text-destructive">{String(hosts.error)}</div>
  if (gateways.error) return <div className="text-sm text-destructive">{String(gateways.error)}</div>
  if (gatewayConfig.error) return <div className="text-sm text-destructive">{String(gatewayConfig.error)}</div>
  if (fleetSecretEnv.error) return <div className="text-sm text-destructive">{String(fleetSecretEnv.error)}</div>
  if (!hostMeta && !gatewayCfg) return <div className="text-muted-foreground">Host not found.</div>
  if (!gatewayMeta && !gatewayCfg) return <div className="text-muted-foreground">Gateway not found.</div>

  return (
    <div className="space-y-6">
      <GatewayCapabilities
        projectId={projectId}
        gatewayId={gatewayId}
        host={host}
        openclaw={openclawCfg}
        canEdit={canEdit}
        configQueryKey={gatewayConfigQueryKey}
        metadataQueryKey={gatewaysQueryOptions.queryKey}
      />

      <GatewayIntegrations
        projectId={projectId}
        gatewayId={gatewayId}
        host={host}
        channels={channelsCfg}
        agents={agentsCfg}
        hooks={hooksCfg}
        skills={skillsCfg}
        plugins={pluginsCfg}
        openclaw={openclawCfg}
        profile={profile}
        fleetSecretEnv={fleetSecretEnvCfg}
        canEdit={canEdit}
        configQueryKey={gatewayConfigQueryKey}
        metadataQueryKey={gatewaysQueryOptions.queryKey}
      />

      <GatewayPersonas
        projectId={projectId}
        host={host}
        gatewayId={gatewayId}
        agents={agentsCfg}
        canEdit={canEdit}
        configQueryKey={gatewayConfigQueryKey}
        metadataQueryKey={gatewaysQueryOptions.queryKey}
      />

      <GatewayWorkspaceDocs projectId={projectId} gatewayId={gatewayId} canEdit={canEdit} />

      <GatewayOpenclawEditor
        projectId={projectId}
        gatewayId={gatewayId}
        host={host}
        initial={openclawCfg}
        canEdit={canEdit}
        configQueryKey={gatewayConfigQueryKey}
        metadataQueryKey={gatewaysQueryOptions.queryKey}
      />
    </div>
  )
}
