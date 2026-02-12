import type { HostTheme } from "~/components/hosts/host-theme"
import { HostThemeBadge } from "~/components/hosts/host-theme"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Link } from "@tanstack/react-router"

export function SetupHeader(props: {
  title?: string
  description?: string
  selectedHost: string | null
  selectedHostTheme?: HostTheme | null
  requiredDone: number
  requiredTotal: number
  deployHref: string | null
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-black tracking-tight">{props.title ?? "Setup"}</h1>
        {props.description ? (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {props.selectedHost ? (
            <>
              <span>Host:</span>
              <HostThemeBadge theme={props.selectedHostTheme} size="xs" />
              <span className="font-medium text-foreground">{props.selectedHost}</span>
            </>
          ) : (
            <span>No host selected yet.</span>
          )}
          <Badge variant="outline">
            {props.requiredDone}/{props.requiredTotal} required
          </Badge>
        </div>
      </div>
      {props.deployHref ? (
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to={props.deployHref} />}
        >
          Open Deploy
        </Button>
      ) : null}
    </div>
  )
}
