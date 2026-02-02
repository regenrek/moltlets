import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useConvexAuth } from "convex/react"
import type { Id } from "../../../../../../../convex/_generated/dataModel"
import { api } from "../../../../../../../convex/_generated/api"
import { BotCapabilities } from "~/components/fleet/bot/bot-capabilities"
import { BotOpenclawEditor } from "~/components/fleet/bot/bot-openclaw-editor"
import { BotIntegrations } from "~/components/fleet/integrations/bot-integrations"
import { BotWorkspaceDocs } from "~/components/fleet/bot/bot-workspace-docs"
import { authClient } from "~/lib/auth-client"
import { useProjectBySlug } from "~/lib/project-data"
import { getClawletsConfig } from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/$botId/settings")({
  component: AgentSettings,
})

function AgentSettings() {
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
  const botCfg = config?.fleet?.bots?.[botId] as any
  const openclawCfg = botCfg?.openclaw ?? {}
  const channelsCfg = botCfg?.channels ?? {}
  const agentsCfg = botCfg?.agents ?? {}
  const hooksCfg = botCfg?.hooks ?? {}
  const skillsCfg = botCfg?.skills ?? {}
  const pluginsCfg = botCfg?.plugins ?? {}
  const profile = botCfg?.profile ?? {}
  const fleetSecretEnv = (config?.fleet as any)?.secretEnv

  if (projectQuery.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (projectQuery.error) return <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
  if (!projectId) return <div className="text-muted-foreground">Project not found.</div>
  if (cfg.isPending) return <div className="text-muted-foreground">Loading…</div>
  if (cfg.error) return <div className="text-sm text-destructive">{String(cfg.error)}</div>
  if (!config) return <div className="text-muted-foreground">Missing config.</div>
  if (!botCfg) return <div className="text-muted-foreground">Agent not found.</div>

  return (
    <div className="space-y-6">
      <BotCapabilities
        projectId={projectId}
        botId={botId}
        host={host}
        openclaw={openclawCfg}
        canEdit={canEdit}
      />

      <BotIntegrations
        projectId={projectId}
        botId={botId}
        host={host}
        channels={channelsCfg}
        agents={agentsCfg}
        hooks={hooksCfg}
        skills={skillsCfg}
        plugins={pluginsCfg}
        openclaw={openclawCfg}
        profile={profile}
        fleetSecretEnv={fleetSecretEnv}
        canEdit={canEdit}
      />

      <BotWorkspaceDocs projectId={projectId} botId={botId} canEdit={canEdit} />

      <BotOpenclawEditor
        projectId={projectId}
        botId={botId}
        host={host}
        initial={openclawCfg}
        canEdit={canEdit}
      />
    </div>
  )
}
