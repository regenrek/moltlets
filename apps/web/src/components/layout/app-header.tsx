import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons"
import { ModeToggle } from "~/components/mode-toggle"
import { Button } from "~/components/ui/button"
import { SidebarTrigger } from "~/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { useAuthState } from "~/lib/auth-state"
import { authClient } from "~/lib/auth-client"

function useActiveProjectId(): string | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const match = pathname.match(/^\/projects\/([^/]+)/)
  return match?.[1] ?? null
}

function AppHeader() {
  const { authDisabled } = useAuthState()
  const projectId = useActiveProjectId()

  return (
    <header className="border-b bg-background">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
        <div className="h-14 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <SidebarTrigger />
            <Link
              to="/projects"
              className="font-black tracking-tight text-lg leading-none"
            >
              Clawdlets
            </Link>
            {projectId ? (
              <div className="text-muted-foreground text-sm truncate">
                Project: <span className="text-foreground">{projectId}</span>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/projects/new" />}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              New Project
            </Button>
            <ModeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-sm" variant="ghost" aria-label="Menu">
                    <HugeiconsIcon
                      icon={MoreHorizontalCircle01Icon}
                      strokeWidth={2}
                    />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {authDisabled ? (
                  <>
                    <DropdownMenuLabel>Dev mode</DropdownMenuLabel>
                    <DropdownMenuItem disabled>Auth disabled</DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : (
                  <AccountMenu />
                )}
                <DropdownMenuItem
                  render={<a href="https://github.com/regenrek/clawdlets" />}
                >
                  GitHub
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}

function AccountMenu() {
  const router = useRouter()
  const { data: session } = authClient.useSession()

  const label = session?.user?.email || session?.user?.name || "Account"

  async function signOut() {
    await authClient.signOut()
    await router.invalidate()
    await router.navigate({ to: "/sign-in" })
  }

  return (
    <>
      <DropdownMenuLabel className="max-w-[240px] truncate">
        {label}
      </DropdownMenuLabel>
      <DropdownMenuItem onClick={() => void signOut()}>
        Sign out
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  )
}

export { AppHeader }
