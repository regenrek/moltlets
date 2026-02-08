import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { AppHeader } from "~/components/layout/app-header"
import { AppSidebar } from "~/components/layout/app-sidebar"
import { ProjectCreateModalProvider } from "~/components/projects/project-create-modal-provider"
import { Button } from "~/components/ui/button"
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar"
import { useProjectBySlug } from "~/lib/project-data"
import { buildHostPath, parseHostName, parseProjectSlug } from "~/lib/project-routing"
import { getProjectHostExposureSummary } from "~/sdk/dashboard"

type OpenHost = {
  name: string
  mode: "bootstrap" | "public"
}

function formatOpenHostLabel(hosts: OpenHost[]) {
  const names = hosts.map((host) => host.name)
  if (names.length <= 2) return names.join(", ")
  return `${names[0]}, ${names[1]} +${names.length - 2} more`
}

function formatOpenHostModes(hosts: OpenHost[]) {
  const modes = Array.from(new Set(hosts.map((host) => host.mode)))
  if (modes.length === 0) return "bootstrap"
  if (modes.length === 1) return modes[0]
  return "bootstrap/public"
}

function OpenSshExposureBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const projectSlug = parseProjectSlug(pathname)
  const activeHost = parseHostName(pathname)
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId

  const cfg = useQuery({
    queryKey: ["projectHostExposureSummary", projectId],
    enabled: Boolean(projectId),
    queryFn: async () =>
      await getProjectHostExposureSummary({
        data: { projectId: projectId as Id<"projects"> },
      }),
  })

  const openHosts = React.useMemo<OpenHost[]>(() => {
    const hosts = cfg.data?.hosts || []
    return hosts.flatMap((host) => {
      if (!host.enabled) return []
      if (host.sshExposureMode === "bootstrap" || host.sshExposureMode === "public") {
        return [{ name: host.hostName, mode: host.sshExposureMode }]
      }
      return []
    })
  }, [cfg.data?.hosts])

  if (!projectSlug || !projectId || openHosts.length === 0) return null

  const targetHost = openHosts.find((host) => host.name === activeHost)?.name ?? openHosts[0]?.name
  const hostLabel = formatOpenHostLabel(openHosts)
  const modeLabel = formatOpenHostModes(openHosts)
  const verb = openHosts.length === 1 ? "is" : "are"
  const setupLinkHost = targetHost || ""
  const settingsPath = targetHost ? `${buildHostPath(projectSlug, targetHost)}/settings` : ""

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 text-destructive">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-2 px-4 py-2 text-sm sm:px-6">
        <span className="font-semibold">Public SSH exposure detected.</span>
        <span className="text-destructive/90">
          {hostLabel} {verb} in {modeLabel} mode.
        </span>
        <span className="text-destructive/80">
          Complete the post-bootstrap checklist to switch SSH to tailnet and lock down public access.
        </span>
        {setupLinkHost ? (
          <Button
            size="sm"
            variant="destructive"
            nativeButton={false}
            render={<Link to="/$projectSlug/hosts/$host/setup" params={{ projectSlug, host: setupLinkHost }} />}
          >
            Open checklist
          </Button>
        ) : null}
        {settingsPath ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to={settingsPath} />}
          >
            Host settings
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function AppShell({
  children,
  showSidebar = true,
}: {
  children: React.ReactNode
  showSidebar?: boolean
}) {
  return (
    <ProjectCreateModalProvider>
      <SidebarProvider>
        {showSidebar ? <AppSidebar /> : null}
        <SidebarInset>
          <div className="min-h-svh flex flex-col">
            <AppHeader showSidebarToggle={showSidebar} />
            <OpenSshExposureBanner />
            <main className="min-h-0 flex-1 overflow-auto">
              <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
                {children}
              </div>
            </main>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ProjectCreateModalProvider>
  )
}

export { AppShell }
