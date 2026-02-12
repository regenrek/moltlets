import { Link } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { ProjectHostsPanel } from "~/components/dashboard/project-hosts-panel"
import { KpiCard } from "~/components/dashboard/kpi-card"
import type { RunRow } from "~/components/dashboard/recent-runs-table"
import { RunActivityChart } from "~/components/dashboard/run-activity-chart"
import { formatShortDateTime, projectStatusBadgeVariant } from "~/components/dashboard/dashboard-utils"
import { ProjectNewHostButton } from "~/components/dashboard/project-new-host-button"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"
import type { DashboardProjectSummary } from "~/sdk/dashboard"

type ProjectHostRow = (typeof api.controlPlane.hosts.listByProject)["_returnType"][number]

export function ProjectOverviewReady(props: {
  projectId: Id<"projects">
  projectSlug: string
  project: DashboardProjectSummary
  hostRows: ProjectHostRow[]
  hostNames: string[]
  runnerOnline: boolean
  isCheckingRunner: boolean
  runs: RunRow[]
  canWrite: boolean
}) {
  const gatewaysValue = props.project.cfg.error ? "—" : props.project.cfg.gatewaysTotal.toLocaleString()
  const hostsValue = props.project.cfg.error
    ? "—"
    : `${props.project.cfg.hostsEnabled.toLocaleString()} / ${props.project.cfg.hostsTotal.toLocaleString()}`
  const defaultHost = props.project.cfg.error ? "—" : props.project.cfg.defaultHost || "—"
  const defaultHostName = props.project.cfg.error ? "" : props.project.cfg.defaultHost || ""
  const canLinkToDefaultHost = Boolean(defaultHostName && props.projectSlug)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight truncate">{props.project.name}</h1>
            <Badge variant={projectStatusBadgeVariant(props.project.status)} className="capitalize">
              {props.project.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm truncate">Fleet host summary, status, and defaults.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectNewHostButton
            projectId={props.projectId}
            projectSlug={props.projectSlug}
            hosts={props.hostNames}
            runnerOnline={props.runnerOnline}
            label="New Host"
          />
        </div>
      </div>

      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <KpiCard title="Gateways" value={gatewaysValue} subtext="Configured" />
        <KpiCard title="Hosts" value={hostsValue} subtext="Enabled / total" />
        <KpiCard title="Default host" value={defaultHost} subtext="From config" />
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
            <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:!py-0">
              <CardTitle>Activity</CardTitle>
              <CardDescription>Runs for the last 14 days.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 sm:p-6">
            <RunActivityChart runs={props.runs} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Project health</CardTitle>
            <CardDescription>Config, services, and status checks.</CardDescription>
          </CardHeader>
          <CardContent>
            {props.project.cfg.error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="font-medium">Config load failed</div>
                <div className="text-muted-foreground mt-1 break-words">{props.project.cfg.error}</div>
                <div className="text-muted-foreground mt-3 text-xs">
                  This repo does <span className="font-medium">not</span> support config migrations or legacy keys.
                  Fix <code>fleet/clawlets.json</code> to the current schema (v1) or re-initialize it and reapply your changes.
                  {props.canWrite ? null : " (Admin required to write config.)"}
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Hosts</div>
                  <div className="font-medium tabular-nums">{hostsValue}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Codex</div>
                  <div className="font-medium">{props.project.cfg.codexEnabled ? "On" : "Off"}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Restic</div>
                  <div className="font-medium">{props.project.cfg.resticEnabled ? "On" : "Off"}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted-foreground text-sm">Config updated</div>
                  <div className="font-medium">
                    {props.project.cfg.configMtimeMs ? formatShortDateTime(props.project.cfg.configMtimeMs) : "—"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              disabled={!canLinkToDefaultHost}
              render={(
                <Link
                  to="/$projectSlug/hosts/$host/logs"
                  params={{ projectSlug: props.projectSlug, host: defaultHostName }}
                />
              )}
            >
              Logs
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              disabled={!canLinkToDefaultHost}
              render={(
                <Link
                  to="/$projectSlug/hosts/$host/audit"
                  params={{ projectSlug: props.projectSlug, host: defaultHostName }}
                />
              )}
            >
              Audit
            </Button>
          </CardFooter>
        </Card>
      </div>

      <ProjectHostsPanel
        projectId={props.projectId}
        projectSlug={props.projectSlug}
        hostRows={props.hostRows}
        runnerOnline={props.runnerOnline}
        isCheckingRunner={props.isCheckingRunner}
      />
    </div>
  )
}
