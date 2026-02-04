import { useQuery } from "@tanstack/react-query"
import { useRouter, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { ServerStackIcon } from "@heroicons/react/24/outline"
import { HostThemeBadge, type HostTheme } from "~/components/hosts/host-theme"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { SidebarTrigger } from "~/components/ui/sidebar"
import { useProjectBySlug } from "~/lib/project-data"
import {
  buildHostSwitchPath,
  buildHostsPath,
  parseHostName,
  parseProjectSlug,
} from "~/lib/project-routing"
import { clawletsConfigQueryOptions } from "~/lib/query-options"

type HostOption = {
  name: string
  enabled: boolean
  isDefault: boolean
  theme?: HostTheme | null
}

function AppHeader({ showSidebarToggle = true }: { showSidebarToggle?: boolean }) {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const projectSlug = parseProjectSlug(pathname)
  const activeHost = parseHostName(pathname) || ""

  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId

  const configQuery = useQuery({
    ...clawletsConfigQueryOptions(projectId),
    enabled: Boolean(projectId),
  })
  const config = configQuery.data?.config as any
  const hostNames = React.useMemo(
    () => Object.keys(config?.hosts || {}).sort(),
    [config],
  )
  const hostOptions = React.useMemo<HostOption[]>(
    () =>
      hostNames.map((name) => ({
        name,
        enabled: config?.hosts?.[name]?.enable !== false,
        isDefault: config?.defaultHost === name,
        theme: config?.hosts?.[name]?.theme ?? null,
      })),
    [config, hostNames],
  )
  const activeTheme = activeHost ? config?.hosts?.[activeHost]?.theme : null

  const handleHostSelect = React.useCallback(
    (next: string) => {
      if (!projectSlug) return
      const target = buildHostSwitchPath({
        projectSlug,
        host: next,
        pathname,
      })
      void router.navigate({ to: target } as any)
    },
    [pathname, projectSlug, router],
  )

  const handleManageHosts = React.useCallback(() => {
    if (!projectSlug) return
    void router.navigate({
      to: buildHostsPath(projectSlug),
    } as any)
  }, [projectSlug, router])

  return (
    <header className="bg-background sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b px-4">
      {showSidebarToggle ? <SidebarTrigger className="-ml-1" /> : null}
      {projectSlug ? (
        <HostSwitcher
          hosts={hostOptions}
          activeHost={activeHost}
          activeTheme={activeTheme ?? null}
          disabled={!projectId || hostOptions.length === 0}
          onSelect={handleHostSelect}
          onManage={handleManageHosts}
        />
      ) : (
        <div className="text-sm font-semibold">Clawlets</div>
      )}
    </header>
  )
}

function HostSwitcher(props: {
  hosts: HostOption[]
  activeHost: string
  activeTheme?: HostTheme | null
  disabled?: boolean
  onSelect: (host: string) => void
  onManage?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const label = props.activeHost || "Hosts"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={props.disabled}
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            size="sm"
            className="h-8 gap-2 max-w-[280px]"
          >
            {props.activeHost ? (
              <HostThemeBadge theme={props.activeTheme} size="xs" />
            ) : (
              <ServerStackIcon className="size-4" />
            )}
            <span className="truncate text-sm font-medium">{label}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="text-muted-foreground" />
          </Button>
        )}
      />
      <PopoverContent className="p-0 w-[300px]" align="start">
        <Command>
          <CommandInput placeholder="Find host..." />
          <CommandList>
            <CommandEmpty>No hosts found.</CommandEmpty>
            <CommandGroup heading="Hosts">
              {props.hosts.map((host) => (
                <CommandItem
                  key={host.name}
                  value={host.name}
                  data-checked={host.name === props.activeHost}
                  onSelect={() => {
                    props.onSelect(host.name)
                    setOpen(false)
                  }}
                >
                  <HostThemeBadge theme={host.theme} size="xs" />
                  <span className="truncate">{host.name}</span>
                  {!host.enabled ? (
                    <Badge variant="outline" className="ml-auto text-[0.6rem]">
                      disabled
                    </Badge>
                  ) : host.isDefault ? (
                    <Badge variant="outline" className="ml-auto text-[0.6rem]">
                      default
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {props.onManage ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Actions">
                  <CommandItem
                    value="manage-hosts"
                    onSelect={() => {
                      props.onManage?.()
                      setOpen(false)
                    }}
                  >
                    Manage hosts
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { AppHeader }
