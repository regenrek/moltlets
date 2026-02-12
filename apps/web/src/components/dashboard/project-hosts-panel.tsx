import { Link } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { Badge } from "~/components/ui/badge"

type ProjectHostRow = (typeof api.controlPlane.hosts.listByProject)["_returnType"][number]

export function ProjectHostsPanel(props: {
  projectId: Id<"projects">
  projectSlug: string
  hostRows: ProjectHostRow[]
  runnerOnline: boolean
  isCheckingRunner: boolean
}) {
  const hostRows = props.hostRows
  const hosts = useMemo(() => hostRows.map((row) => row.hostName), [hostRows])
  if (hosts.length === 0) return null

  return (
    <div className="space-y-6">
      <RunnerStatusBanner
        projectId={props.projectId}
        setupHref={`/${props.projectSlug}/runner`}
        runnerOnline={props.runnerOnline}
        isChecking={props.isCheckingRunner}
      />

      <div className="rounded-xl border bg-card">
        <div className="grid grid-cols-12 gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
          <div className="col-span-5">Name</div>
          <div className="col-span-4">Public/Target</div>
          <div className="col-span-2">Update ring</div>
          <div className="col-span-1 text-right">Status</div>
        </div>
        <div className="divide-y">
          {hostRows.map((hostRow) => {
            const host = hostRow.hostName
            const enabled = (hostRow.desired?.enabled ?? true) !== false
            const channel = String(hostRow.desired?.selfUpdateChannel || hostRow.desired?.updateRing || "prod")
            const target = hostRow.desired?.targetHost || "—"
            return (
              <Link
                key={host}
                to="/$projectSlug/hosts/$host"
                params={{ projectSlug: props.projectSlug, host }}
                className="grid grid-cols-12 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
              >
                <div className="col-span-5 flex min-w-0 items-center gap-2">
                  <span className={enabled ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-muted-foreground/40"} />
                  <div className="truncate font-medium">{host}</div>
                </div>
                <div className="col-span-4 truncate text-sm text-muted-foreground">
                  {target}
                </div>
                <div className="col-span-2 flex min-w-0 items-center gap-2">
                  <Badge variant="outline" className="truncate">
                    {channel || "prod"}
                  </Badge>
                </div>
                <div className="col-span-1 flex justify-end">
                  <Badge variant={enabled ? "secondary" : "outline"}>
                    {enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

    </div>
  )
}
