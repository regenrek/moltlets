import { Link } from "@tanstack/react-router"
import { useMemo } from "react"

import { Avatar, AvatarFallback } from "~/components/ui/avatar"
import { buttonVariants } from "~/components/ui/button"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "~/components/ui/item"
import { cn } from "~/lib/utils"
import { buildOpenClawGatewayConfig } from "@clawlets/core/lib/openclaw/config-invariants"

export function getGatewayChannels(params: { config: unknown; host: string; gatewayId: string }): string[] {
  const hostCfg = (params.config as any)?.hosts?.[params.host]
  const gatewayCfg = hostCfg?.gateways?.[params.gatewayId] || {}
  const openclawCfg = gatewayCfg?.openclaw || {}
  const typedChannels =
    gatewayCfg?.channels && typeof gatewayCfg.channels === "object" && !Array.isArray(gatewayCfg.channels)
      ? Object.keys(gatewayCfg.channels)
      : []
  const openclawChannels =
    openclawCfg?.channels && typeof openclawCfg.channels === "object" && !Array.isArray(openclawCfg.channels)
      ? Object.keys(openclawCfg.channels)
      : []
  return Array.from(new Set([...typedChannels, ...openclawChannels])).sort()
}

export function formatChannelsLabel(channels: string[]): string {
  if (channels.length === 0) return "(none)"
  if (channels.length <= 4) return channels.join(", ")
  return `${channels.slice(0, 4).join(", ")} (+${channels.length - 4})`
}

function getGatewayPort(params: { config: unknown; host: string; gatewayId: string }): number | null {
  try {
    const res = buildOpenClawGatewayConfig({
      config: params.config as any,
      hostName: params.host,
      gatewayId: params.gatewayId,
    })
    const port = (res.invariants as any)?.gateway?.port
    if (typeof port === "number") return port
    if (typeof port === "string") {
      const parsed = Number(port)
      return Number.isFinite(parsed) ? parsed : null
    }
  } catch {
    return null
  }
  return null
}

export function GatewayRoster(props: {
  projectSlug: string
  host: string
  projectId: string
  gateways: string[]
  config: any
  canEdit: boolean
  emptyText?: string
}) {
  if (props.gateways.length === 0) {
    return <div className="text-muted-foreground">{props.emptyText ?? "No gateways yet."}</div>
  }

  const portByGateway = useMemo(() => {
    const next = new Map<string, number | null>()
    for (const gatewayId of props.gateways) {
      next.set(gatewayId, getGatewayPort({ config: props.config, host: props.host, gatewayId }))
    }
    return next
  }, [props.gateways, props.config])

  const portConflicts = useMemo(() => {
    const byPort = new Map<number, string[]>()
    for (const [gatewayId, port] of portByGateway.entries()) {
      if (typeof port !== "number") continue
      const bucket = byPort.get(port) ?? []
      bucket.push(gatewayId)
      byPort.set(port, bucket)
    }
    return Array.from(byPort.entries())
      .filter(([, gateways]) => gateways.length > 1)
      .sort(([a], [b]) => a - b)
  }, [portByGateway])

  return (
    <div className="w-full space-y-3">
      {portConflicts.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <div className="font-medium text-destructive">Gateway port conflicts detected</div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {portConflicts.map(([port, gateways]) => (
              <li key={port}>
                port {port}: {gateways.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="w-full overflow-hidden rounded-lg border">
        <ItemGroup className="gap-0">
          {props.gateways.map((gatewayId) => {
            const channels = getGatewayChannels({ config: props.config, host: props.host, gatewayId })
            const channelsLabel = formatChannelsLabel(channels)
            const port = portByGateway.get(gatewayId)
            const portLabel = typeof port === "number" ? `port ${port}` : null

          return (
            <div
              key={gatewayId}
              className="group relative flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <Item variant="default" className="relative z-10 border-0 rounded-none px-0 py-0 flex-1">
                <ItemMedia>
                  <Avatar>
                    <AvatarFallback>{gatewayId.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="gap-0">
                  <ItemTitle className="text-base">{gatewayId}</ItemTitle>
                  <ItemDescription className="text-xs">
                    channels: <code>{channelsLabel}</code>
                    {portLabel ? ` · ${portLabel}` : ""}
                  </ItemDescription>
                </ItemContent>
              </Item>

              <span
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "relative z-10 shadow-sm pointer-events-none",
                )}
              >
                Manage
              </span>

              <Link
                to="/$projectSlug/hosts/$host/gateways/$gatewayId/overview"
                params={{ projectSlug: props.projectSlug, host: props.host, gatewayId }}
                aria-label={`Manage ${gatewayId}`}
                className="absolute inset-0 z-20 rounded-md transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
          )
        })}
        </ItemGroup>
      </div>
    </div>
  )
}
