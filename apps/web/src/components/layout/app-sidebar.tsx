import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronUpDownIcon,
  CircleStackIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  DocumentTextIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import {
  Sidebar,
  SidebarContent,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarGroupLabel,
  SidebarSeparator,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "~/components/ui/dropdown-menu"
import { Label } from "~/components/ui/label"
import { HostThemeBadge } from "~/components/hosts/host-theme"
import { NavUser } from "~/components/layout/nav-user"
import { useProjectCreateModal } from "~/components/projects/project-create-modal-provider"
import { useProjectBySlug, useProjectsList } from "~/lib/project-data"
import {
  buildHostPath,
  buildHostsPath,
  buildProjectBasePath,
  buildProjectGlobalBase,
  getInstanceHostFromWindow,
  parseHostName,
  parseProjectSlug,
  slugifyProjectName,
  storeLastProjectSlug,
} from "~/lib/project-routing"
import { cn } from "~/lib/utils"

function NavLink({
  item,
  isActive,
}: {
  item: NavItem
  isActive: boolean
}) {
  const iconNode =
    item.iconNode ?? (item.icon ? <item.icon aria-hidden="true" /> : null)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={
          item.tooltip
            ? {
                children: (
                  <div className="space-y-0.5">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-background/70">{item.tooltip}</div>
                  </div>
                ),
              }
            : undefined
        }
        render={
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to={item.to} />}
            className={cn(
              "w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}
          />
        }
      >
        {iconNode ? <span className="shrink-0">{iconNode}</span> : null}
        <span className="truncate">{item.label}</span>
        {item.hasChildren ? (
          <ChevronRightIcon className="ml-auto size-4 shrink-0 text-sidebar-foreground/70" aria-hidden="true" />
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

type NavItem = {
  to: string
  label: string
  icon?: React.ComponentType<React.ComponentProps<"svg">>
  iconNode?: React.ReactNode
  tooltip?: string
  hasChildren?: boolean
  aliases?: string[]
}

function AppSidebar() {
  const { openProjectCreateModal } = useProjectCreateModal()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const instanceHost = getInstanceHostFromWindow()
  const projectSlug = parseProjectSlug(pathname)
  const activeHost = parseHostName(pathname)
  const projectsQuery = useProjectsList()
  const projects = projectsQuery.data
  const activeProject = React.useMemo(
    () =>
      projectSlug && projects?.length
        ? projects.find((project) => slugifyProjectName(project.name) === projectSlug) || null
        : null,
    [projectSlug, projects],
  )
  const { projectId } = useProjectBySlug(projectSlug)
  const hostsQuery = useQuery({
    ...convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    enabled: Boolean(projectId),
  })
  const hostByName = React.useMemo(
    () => new Map((hostsQuery.data ?? []).map((row) => [row.hostName, row] as const)),
    [hostsQuery.data],
  )
  const activeHostTheme = activeHost
    ? (hostByName.get(activeHost)?.desired?.theme
        ? { color: hostByName.get(activeHost)?.desired?.theme as any }
        : null)
    : null
  const [navQuery, setNavQuery] = React.useState("")

  if (!projectSlug) {
    return (
      <Sidebar variant="sidebar" collapsible="icon">
        <SidebarContent />
        <SidebarRail />
      </Sidebar>
    )
  }

  const projectBase = buildProjectBasePath(projectSlug)
  const projectGlobalBase = buildProjectGlobalBase(projectSlug)
  const hostsBase = buildHostsPath(projectSlug)
  const hostBase = activeHost ? buildHostPath(projectSlug, activeHost) : null
  const hostAwarePath = (hostSuffix: string, globalSlug: string) =>
    hostBase ? `${hostBase}/${hostSuffix}` : `${projectGlobalBase}/${globalSlug}`
  const inHostSettingsScope = Boolean(hostBase && pathname.startsWith(`${hostBase}/settings`))
  const overviewIcon = activeHost ? (
    <HostThemeBadge theme={activeHostTheme} size="xs" />
  ) : null

  const infraNav: NavItem[] = [
    {
      to: hostBase ?? hostsBase,
      label: hostBase ? "Overview" : "Hosts",
      icon: hostBase ? undefined : ServerStackIcon,
      iconNode: hostBase ? overviewIcon : undefined,
      tooltip: hostBase ? "Single host overview." : "Fleet host overview.",
    },
    {
      to: hostBase ? `${hostBase}/setup` : `${projectBase}/runner`,
      label: "Setup",
      icon: CheckIcon,
      tooltip: "Server and OpenClaw setup guides.",
      aliases: hostBase ? [`${hostBase}/openclaw-setup`] : undefined,
    },
    {
      to: hostAwarePath("deploy", "deploy"),
      label: "Deploy",
      icon: BoltIcon,
      aliases: [
        hostAwarePath("bootstrap", "bootstrap"),
        hostAwarePath("updates", "updates"),
      ],
    },
    {
      to: hostAwarePath("runs", "runs"),
      label: "Runs",
      icon: DocumentTextIcon,
    },
    {
      to: hostAwarePath("logs", "logs"),
      label: "Server Logs",
      icon: CommandLineIcon,
    },
    {
      to: hostAwarePath("audit", "audit"),
      label: "Audit",
      icon: ShieldCheckIcon,
    },
    {
      to: hostAwarePath("restart", "restart"),
      label: "Restart",
      icon: ArrowPathIcon,
    },
    {
      to: hostAwarePath("settings", "settings"),
      label: "Settings",
      icon: Cog6ToothIcon,
      tooltip: "Host-level infra settings.",
      hasChildren: Boolean(hostBase),
      aliases: hostBase ? [`${hostBase}/settings/vpn`] : undefined,
    },
  ]

  const openclawNav: NavItem[] = [
    {
      to: hostAwarePath("gateways", "gateways"),
      label: "Gateways",
      icon: UserGroupIcon,
    },
    {
      to: `${projectGlobalBase}/channels`,
      label: "Channels",
      icon: ChatBubbleLeftRightIcon,
    },
    {
      to: hostAwarePath("secrets", "secrets"),
      label: "Secrets",
      icon: KeyIcon,
    },
    {
      to: `${projectGlobalBase}/skills`,
      label: "Skills",
      icon: SparklesIcon,
      aliases: [`${projectBase}/setup/fleet`],
    },
  ]

  const projectNav: NavItem[] = projectId
    ? [
        {
          to: `${projectBase}/security`,
          label: "Security",
          icon: KeyIcon,
          tooltip: "Project-wide API keys and SSH keys.",
        },
        {
          to: `${projectBase}/cache`,
          label: "Cache",
          icon: CircleStackIcon,
          tooltip: "Nix binary cache policy (substituters, trusted keys, netrc).",
        },
      ]
    : []
  const settingsNav: NavItem[] = hostBase
    ? [
        {
          to: `${hostBase}/settings`,
          label: "General",
          icon: Cog6ToothIcon,
        },
        {
          to: `${hostBase}/settings/vpn`,
          label: "VPN / Tailscale",
          icon: ShieldCheckIcon,
        },
      ]
    : []

  const normalizedQuery = navQuery.trim().toLowerCase()
  const matches = (item: NavItem) =>
    !normalizedQuery || item.label.toLowerCase().includes(normalizedQuery)
  const filteredInfra = infraNav.filter(matches)
  const filteredOpenclaw = openclawNav.filter(matches)
  const filteredProject = projectNav.filter(matches)
  const filteredSettings = settingsNav.filter(matches)
  const hasMatches =
    filteredInfra.length || filteredOpenclaw.length || filteredProject.length || filteredSettings.length

  const isActiveItem = (item: NavItem) => {
    const targets = [item.to, ...(item.aliases ?? [])]
    return targets.some((target) => pathname === target || pathname.startsWith(`${target}/`))
  }

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="hover:bg-muted/60 hover:text-foreground active:bg-muted/70 active:text-foreground data-[state=open]:bg-muted/70 data-[state=open]:text-foreground"
                  >
                    <div className="bg-muted text-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                      <img src="/clawlets-icon.svg" alt="" aria-hidden="true" className="size-4" />
                    </div>
                    <div className="flex flex-col gap-0.5 leading-none">
                      <span className="font-medium">{activeProject?.name || "Select project"}</span>
                      <span className="text-muted-foreground text-xs">{instanceHost}</span>
                    </div>
                    <ChevronUpDownIcon className="ml-auto size-4" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent align="start">
                {projectsQuery.isPending ? (
                  <DropdownMenuItem disabled>Loading projects...</DropdownMenuItem>
                ) : (projects?.length ?? 0) > 0 ? (
                  projects?.map((project) => {
                    const slug = slugifyProjectName(project.name)
                    const isActive = slug === projectSlug
                    return (
                      <DropdownMenuItem
                        key={project._id}
                        nativeButton={false}
                        render={<Link to={buildProjectBasePath(slug)} />}
                        onClick={() => {
                          storeLastProjectSlug(slug)
                        }}
                      >
                        <span className="truncate">{project.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground capitalize">
                          {project.status}
                        </span>
                        {isActive ? <CheckIcon className="ml-2 size-4" /> : null}
                      </DropdownMenuItem>
                    )
                  })
                ) : (
                  <DropdownMenuItem disabled>No projects</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openProjectCreateModal}>
                  New project
                </DropdownMenuItem>
                <DropdownMenuItem nativeButton={false} render={<Link to="/projects" />}>
                  View all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <form onSubmit={(event) => event.preventDefault()} className="group-data-[collapsible=icon]:hidden">
          <SidebarGroup className="py-0">
            <SidebarGroupContent className="relative">
              <Label htmlFor="sidebar-search" className="sr-only">
                Search
              </Label>
              <SidebarInput
                id="sidebar-search"
                value={navQuery}
                onChange={(event) => setNavQuery(event.target.value)}
                placeholder="Search navigation..."
                className="pl-8"
              />
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
            </SidebarGroupContent>
          </SidebarGroup>
        </form>
      </SidebarHeader>
      <SidebarContent>
        {normalizedQuery && !hasMatches ? (
          <div className="px-4 py-2 text-xs text-muted-foreground">
            No matches.
          </div>
        ) : null}
        {inHostSettingsScope && hostBase ? (
          <>
            <SidebarSeparator className="mx-2 my-0" />
            <SidebarGroup className="py-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link to={hostBase} />}
                        className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      />
                    }
                  >
                    <ArrowLeftIcon className="size-4" aria-hidden="true" />
                    <span className="truncate">Back to host</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <SidebarSeparator className="mx-2 my-0" />
          </>
        ) : null}
        {inHostSettingsScope ? (
          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarMenu>
              {filteredSettings.map((item) => (
                <NavLink
                  key={`${item.to}:${item.label}`}
                  item={item}
                  isActive={isActiveItem(item)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : filteredInfra.length ? (
          <SidebarGroup>
            <SidebarGroupLabel>Infra</SidebarGroupLabel>
            <SidebarMenu>
              {filteredInfra.map((item) => (
                <NavLink
                  key={`${item.to}:${item.label}`}
                  item={item}
                  isActive={isActiveItem(item)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
        {!inHostSettingsScope && filteredOpenclaw.length ? (
          <>
            {filteredInfra.length ? <SidebarSeparator /> : null}
            <SidebarGroup>
              <SidebarGroupLabel>OpenClaw</SidebarGroupLabel>
              <SidebarMenu>
                {filteredOpenclaw.map((item) => (
                  <NavLink
                    key={`${item.to}:${item.label}`}
                    item={item}
                    isActive={isActiveItem(item)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        {!inHostSettingsScope && filteredProject.length ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarMenu>
                {filteredProject.map((item) => (
                  <NavLink
                    key={`${item.to}:${item.label}`}
                    item={item}
                    isActive={isActiveItem(item)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarSeparator />
          </>
        ) : null}
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export { AppSidebar }
