import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import type { Id } from "../../../../../../../convex/_generated/dataModel"
import { api } from "../../../../../../../convex/_generated/api"
import { GatewayPersonas } from "~/components/fleet/bot/gateway-personas"
import { authClient } from "~/lib/auth-client"
import { useProjectBySlug } from "~/lib/project-data"
import { getClawletsConfig } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/hosts/$host/bots/$botId/personas")({
  component: BotPersonas,
})

function BotPersonas() {
  const { projectSlug, host, botId } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const project = useQuery({
    ...convexQuery(api.projects.get, { projectId: projectId as Id<"projects"> }),
    gcTime: 5_000,
    enabled: Boolean(projectId) && canQuery,
  })
  const canEdit = project.data?.role === "admin"

  const cfg = useQuery({
    queryKey: ["clawletsConfig", projectId],
    queryFn: async () =>
      await getClawletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId) && canQuery,
  })

  const config = cfg.data?.config
  const botCfg = (config as any)?.hosts?.[host]?.bots?.[botId] as any
  const agentsCfg = botCfg?.agents ?? {}

  if (projectQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (projectQuery.error) return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  if (!projectId) return <div className="text-muted-foreground">Project not found.</div>
  if (cfg.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (cfg.error) return <div className="text-sm text-destructive">{String(cfg.error)}</div>
  if (!config) return <div className="text-muted-foreground">Missing config.</div>
  if (!botCfg) return <div className="text-muted-foreground">Bot not found.</div>

  return (
    <GatewayPersonas projectId={projectId} host={host} botId={botId} agents={agentsCfg} canEdit={canEdit} />
  )
}
