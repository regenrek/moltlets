/// <reference types="vite/client" />
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  redirect,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router"
import * as React from "react"
import type { QueryClient } from "@tanstack/react-query"
import type { ConvexQueryClient } from "@convex-dev/react-query"
import { useConvexMutation } from "@convex-dev/react-query"
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary"
import { NotFound } from "~/components/NotFound"
import { ThemeInitScript } from "~/components/theme-init-script"
import { ThemeProvider } from "~/components/theme-provider"
import { getTheme, type Theme } from "~/lib/theme"
import appCss from "~/styles/app.css?url"
import { seo } from "~/utils/seo"
import { AppShell } from "~/components/layout/app-shell"
import { Toaster } from "~/components/ui/sonner"
import { api } from "../../convex/_generated/api"
import { useConvexAuth } from "convex/react"
import { currentUserQueryOptions } from "~/lib/query-options"
import { ensureCurrentAuthUserBootstrap, getAuthBootstrap } from "~/sdk/auth"
import { authClient } from "~/lib/auth-client"
import { parseProjectSlug } from "~/lib/project-routing"
import { isAuthError, isEnsureCurrentRequiredError } from "~/lib/auth-utils"

let lastClientBootstrapToken: string | null = null

function shouldForceFreshCurrentUserFetch(token: string): boolean {
  if (typeof window === "undefined") return true
  if (lastClientBootstrapToken !== token) {
    lastClientBootstrapToken = token
    return true
  }
  return false
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  beforeLoad: async ({ location, context }) => {
    const { token } = await getAuthBootstrap()

    if (token && context.convexQueryClient.serverHttpClient) {
      context.convexQueryClient.serverHttpClient.setAuth(token)
    }

    const pathname = location.pathname
    const isAuthRoute = pathname === "/sign-in" || pathname.startsWith("/api/auth/")
    if (!token && typeof window !== "undefined") {
      lastClientBootstrapToken = null
    }
    if (!isAuthRoute && !token) {
      throw redirect({ to: "/sign-in" })
    }
    if (token && !isAuthRoute) {
      try {
        const currentUserOptions = currentUserQueryOptions()
        const currentUser = shouldForceFreshCurrentUserFetch(token)
          ? await context.queryClient.fetchQuery({ ...currentUserOptions, staleTime: 0 })
          : await context.queryClient.ensureQueryData(currentUserOptions)
        if (!currentUser) {
          const bootstrap = await ensureCurrentAuthUserBootstrap()
          if (!bootstrap.ensured) throw redirect({ to: "/sign-in" })
          await context.queryClient.invalidateQueries({ queryKey: currentUserOptions.queryKey })
          const refreshedCurrentUser = await context.queryClient.fetchQuery({ ...currentUserOptions, staleTime: 0 })
          if (!refreshedCurrentUser) throw redirect({ to: "/sign-in" })
        }
      } catch (error) {
        if (isAuthError(error)) {
          throw redirect({ to: "/sign-in" })
        }
        throw error
      }
    }

    return { token }
  },
  loader: () => getTheme(),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      ...seo({
        title: "Clawlets",
        description: "Self-hosted web UI for managing Infra & Openclaw fleets.",
      }),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
      { rel: "manifest", href: "/site.webmanifest", color: "#ffffff" },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  errorComponent: (props: ErrorComponentProps) => {
    return (
      <RootDocument>
        <DefaultCatchBoundary {...props} />
      </RootDocument>
    )
  },
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
})

function RootComponent() {
  const { token } = Route.useRouteContext()
  const router = useRouter()
  const convexQueryClient = router.options.context.convexQueryClient
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const showShell = pathname !== "/sign-in"
  const projectSlug = parseProjectSlug(pathname)
  const showSidebar = Boolean(projectSlug)

  const app = showShell ? (
    <AppShell showSidebar={showSidebar}>
      <Outlet />
    </AppShell>
  ) : (
    <Outlet />
  )

  return (
    <RootDocument>
      <ConvexBetterAuthProvider
        client={convexQueryClient.convexClient}
        authClient={authClient}
        initialToken={token}
      >
        <AuthErrorWatcher />
        <EnsureAuthedUser />
        <AuthGate app={app} />
      </ConvexBetterAuthProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme
  return (
    <html lang="en" className={initial === "system" ? "" : initial} suppressHydrationWarning>
      <head>
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider initial={initial}>
          {children}
          <Toaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

function EnsureAuthedUser() {
  const ensureCurrent = useConvexMutation(api.identity.users.ensureCurrent)
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { data: session, isPending } = authClient.useSession()
  const hasSession = Boolean(session?.user?.id)

  React.useEffect(() => {
    if (isPending || isLoading || !isAuthenticated || !hasSession) return
    void ensureCurrent({}).catch(() => null)
  }, [ensureCurrent, hasSession, isAuthenticated, isLoading, isPending])

  return null
}

function AuthGate({ app }: { app: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: session, isPending } = authClient.useSession()
  const { isLoading } = useConvexAuth()
  const isAuthRoute = pathname === "/sign-in" || pathname.startsWith("/api/auth/")
  const hasSession = Boolean(session?.user?.id)

  if (isAuthRoute) return <>{app}</>
  if (isPending || isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-muted-foreground">
        Checking session…
      </div>
    )
  }
  if (!hasSession) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-muted-foreground">
        Redirecting to sign-in…
      </div>
    )
  }

  return <>{app}</>
}

function AuthErrorWatcher() {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const queryClient = router.options.context.queryClient
  const redirectingRef = React.useRef(false)
  const bootstrappingRef = React.useRef(false)

  React.useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event?.type !== "updated") return
      const error = event.query?.state?.error
      if (!isAuthError(error)) return
      if (pathname === "/sign-in" || pathname.startsWith("/api/auth/")) return
      if (isEnsureCurrentRequiredError(error)) {
        if (bootstrappingRef.current) return
        bootstrappingRef.current = true
        void (async () => {
          try {
            const bootstrap = await ensureCurrentAuthUserBootstrap()
            if (!bootstrap.ensured) {
              await authClient.signOut()
              await router.invalidate()
              await router.navigate({ to: "/sign-in" })
              return
            }
            await queryClient.invalidateQueries({ queryKey: currentUserQueryOptions().queryKey })
            await router.invalidate()
          } catch {
            // let regular auth handling paths deal with persistent failures
          } finally {
            bootstrappingRef.current = false
          }
        })()
        return
      }
      if (redirectingRef.current) return
      redirectingRef.current = true
      void (async () => {
        try {
          await authClient.signOut()
          await router.invalidate()
        } catch {
          // ignore sign-out failures, still redirect
        } finally {
          await router.navigate({ to: "/sign-in" })
          redirectingRef.current = false
        }
      })()
    })
  }, [pathname, queryClient, router])

  return null
}
