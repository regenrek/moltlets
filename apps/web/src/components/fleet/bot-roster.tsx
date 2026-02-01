import { Link } from "@tanstack/react-router"

import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { buttonVariants } from "~/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "~/components/ui/item"
import { cn } from "~/lib/utils"

export function getBotChannels(params: { config: unknown; botId: string }): string[] {
  const fleet = (params.config as any)?.fleet
  const botCfg = fleet?.bots?.[params.botId] || {}
  const clawdbotCfg = botCfg?.clawdbot || {}
  const channels =
    clawdbotCfg?.channels && typeof clawdbotCfg.channels === "object" && !Array.isArray(clawdbotCfg.channels)
      ? Object.keys(clawdbotCfg.channels).sort()
      : []
  return channels
}

export function formatChannelsLabel(channels: string[]): string {
  if (channels.length === 0) return "(none)"
  if (channels.length <= 4) return channels.join(", ")
  return `${channels.slice(0, 4).join(", ")} (+${channels.length - 4})`
}

export function BotRoster(props: {
  projectSlug: string
  host: string
  projectId: string
  bots: string[]
  config: any
  canEdit: boolean
  emptyText?: string
}) {
  if (props.bots.length === 0) {
    return <div className="text-muted-foreground">{props.emptyText ?? "No agents yet."}</div>
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border">
      <ItemGroup className="gap-0">
        {props.bots.map((botId) => {
          const channels = getBotChannels({ config: props.config, botId })
          const channelsLabel = formatChannelsLabel(channels)

          return (
            <div
              key={botId}
              className="group relative flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <Item variant="default" className="relative z-10 border-0 rounded-none px-0 py-0 flex-1">
                <ItemMedia>
                  <Avatar>
                    <AvatarFallback>{botId.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="gap-0">
                  <ItemTitle className="text-base">
                    {botId}
                  </ItemTitle>
                  <ItemDescription className="text-xs">
                    channels: <code>{channelsLabel}</code>
                  </ItemDescription>
                </ItemContent>
              </Item>

              <span
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "relative z-10 shadow-sm pointer-events-none"
                )}
              >
                Manage
              </span>

              <Link
                to="/$projectSlug/hosts/$host/agents/$botId/overview"
                params={{ projectSlug: props.projectSlug, host: props.host, botId }}
                aria-label={`Manage ${botId}`}
                className="absolute inset-0 z-20 rounded-md transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
          )
        })}
      </ItemGroup>
    </div>
  )
}
