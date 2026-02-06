import { useQuery } from "@tanstack/react-query"
import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import {
  ArrowPathIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
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
import { clawletsConfigQueryOptions } from "~/lib/query-options"
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
  aliases?: string[]
}

function AppSidebar() {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const instanceHost = getInstanceHostFromWindow()
  const projectSlug = parseProjectSlug(pathname)
  const activeHost = parseHostName(pathname)
  const projectsQuery = useProjectsList()
  const projects = projectsQuery.data ?? []
  const activeProject = React.useMemo(
    () =>
      projectSlug
        ? projects.find((project) => slugifyProjectName(project.name) === projectSlug) || null
        : null,
    [projectSlug, projects],
  )
  const { projectId } = useProjectBySlug(projectSlug)
  const configQuery = useQuery({
    ...clawletsConfigQueryOptions(projectId),
    enabled: Boolean(projectId),
  })
  const config = configQuery.data?.config as any
  const activeHostTheme = activeHost ? (config?.hosts as any)?.[activeHost]?.theme : null
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
  const hostAwarePath = React.useCallback(
    (hostSuffix: string, globalSlug: string) =>
      hostBase ? `${hostBase}/${hostSuffix}` : `${projectGlobalBase}/${globalSlug}`,
    [hostBase, projectGlobalBase],
  )
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
      to: `${projectBase}/setup`,
      label: "Setup",
      icon: CheckIcon,
      tooltip: "Guided first deploy checklist.",
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

  const normalizedQuery = navQuery.trim().toLowerCase()
  const matches = (item: NavItem) =>
    !normalizedQuery || item.label.toLowerCase().includes(normalizedQuery)
  const filteredInfra = infraNav.filter(matches)
  const filteredOpenclaw = openclawNav.filter(matches)
  const filteredProject = projectNav.filter(matches)
  const hasMatches =
    filteredInfra.length || filteredOpenclaw.length || filteredProject.length

  const isActiveItem = React.useCallback((item: NavItem) => {
    const targets = [item.to, ...(item.aliases ?? [])]
    return targets.some((target) => pathname === target || pathname.startsWith(`${target}/`))
  }, [pathname])

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
                ) : projects.length ? (
                  projects.map((project) => {
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
                <DropdownMenuItem nativeButton={false} render={<Link to="/projects/new" />}>
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
        {filteredInfra.length ? (
          <SidebarGroup>
            <SidebarGroupLabel>Infra</SidebarGroupLabel>
            <SidebarMenu>
              {filteredInfra.map((item) => (
                <NavLink
                  key={item.to}
                  item={item}
                  isActive={isActiveItem(item)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
        {filteredOpenclaw.length ? (
          <>
            {filteredInfra.length ? <SidebarSeparator /> : null}
            <SidebarGroup>
              <SidebarGroupLabel>OpenClaw</SidebarGroupLabel>
              <SidebarMenu>
                {filteredOpenclaw.map((item) => (
                  <NavLink
                    key={item.to}
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
        {filteredProject.length ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarMenu>
                {filteredProject.map((item) => (
                  <NavLink
                    key={item.to}
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
