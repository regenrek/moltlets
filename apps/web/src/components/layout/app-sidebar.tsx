import { Link, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Folder01Icon,
  Settings02Icon,
  Shield01Icon,
  Rocket01Icon,
  FileEditIcon,
  ComputerTerminalIcon,
  Clock01Icon,
} from "@hugeicons/core-free-icons"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"

type NavItem = {
  to: string
  label: string
  icon?: React.ComponentProps<typeof HugeiconsIcon>["icon"]
}

function useActiveProjectId(): string | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const match = pathname.match(/^\/projects\/([^/]+)/)
  return match?.[1] ?? null
}

function NavLink({
  item,
  isActive,
}: {
  item: NavItem
  isActive: boolean
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
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
        {item.icon ? (
          <HugeiconsIcon icon={item.icon} strokeWidth={2} />
        ) : null}
        <span className="truncate">{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function AppSidebarContent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const projectId = useActiveProjectId()

  const base: NavItem[] = [
    { to: "/projects", label: "Projects", icon: Folder01Icon },
  ]

  const projectBase = projectId ? `/projects/${projectId}` : null
  const setup: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/setup/fleet`, label: "Fleet", icon: Settings02Icon },
        { to: `${projectBase}/setup/hosts`, label: "Hosts" },
        { to: `${projectBase}/setup/bots`, label: "Bots" },
        { to: `${projectBase}/setup/providers`, label: "Providers" },
        { to: `${projectBase}/setup/secrets`, label: "Secrets", icon: Shield01Icon },
        { to: `${projectBase}/setup/doctor`, label: "Doctor" },
        { to: `${projectBase}/setup/bootstrap`, label: "Bootstrap", icon: Rocket01Icon },
      ]
    : []

  const operate: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/operate/deploy`, label: "Deploy" },
        { to: `${projectBase}/operate/logs`, label: "Logs" },
        { to: `${projectBase}/operate/audit`, label: "Audit" },
        { to: `${projectBase}/operate/restart`, label: "Restart" },
      ]
    : []

  const advanced: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/advanced/editor`, label: "Raw Editor", icon: FileEditIcon },
        { to: `${projectBase}/advanced/commands`, label: "Command Runner", icon: ComputerTerminalIcon },
        { to: `${projectBase}/runs`, label: "Runs", icon: Clock01Icon },
      ]
    : []

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Home</SidebarGroupLabel>
          <SidebarMenu>
            {base.map((item) => (
              <NavLink key={item.to} item={item} isActive={pathname === item.to} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {projectId ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Setup</SidebarGroupLabel>
              <SidebarMenu>
                {setup.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Operate</SidebarGroupLabel>
              <SidebarMenu>
                {operate.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Advanced</SidebarGroupLabel>
              <SidebarMenu>
                {advanced.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
    </Sidebar>
  )
}

function AppSidebar({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <AppSidebarContent />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}

export { AppSidebar }
