/// <reference types="vite/client" />
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production"
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import * as React from "react"
import { Toaster } from "sonner"
import type { QueryClient } from "@tanstack/react-query"
import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary"
import { IconLink } from "~/components/IconLink"
import { NotFound } from "~/components/NotFound"
import { ThemeInitScript } from "~/components/theme-init-script"
import { ThemeProvider } from "~/components/theme-provider"
import { ModeToggle } from "~/components/mode-toggle"
import { getTheme, type Theme } from "~/lib/theme"
import appCss from "~/styles/app.css?url"
import { seo } from "~/utils/seo"
import { Loader } from "~/components/Loader"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
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
        title:
          "TanStack Start | Type-Safe, Client-First, Full-Stack React Framework",
        description: `TanStack Start is a type-safe, client-first, full-stack React framework. `,
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
      { rel: "manifest", href: "/site.webmanifest", color: "#fffff" },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  errorComponent: (props) => {
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
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme
  return (
    <html lang="en" className={initial === "system" ? "" : initial}>
      <head>
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider initial={initial}>
          <div className="h-screen flex flex-col min-h-0">
            <div className="bg-primary border-b border-primary/80 flex items-center justify-between py-4 px-8 box-border">
              <div className="flex items-center gap-4">
                <div>
                  <Link to="/" className="block leading-tight">
                    <div className="font-black text-2xl text-primary-foreground">
                      Trellaux
                    </div>
                    <div className="text-primary-foreground/60">
                      a TanStack Demo
                    </div>
                  </Link>
                </div>
                <LoadingIndicator />
              </div>
              <div className="flex items-center gap-6">
                <ModeToggle />
                <IconLink
                  href="https://github.com/TanStack/router/tree/main/examples/react/start-trellaux"
                  label="Source"
                  icon="/github-mark-white.png"
                />
                <IconLink
                  href="https://tanstack.com"
                  icon="/tanstack.png"
                  label="TanStack"
                />
              </div>
            </div>

            <div className="grow min-h-0 h-full flex flex-col">
              {children}
              <Toaster />
            </div>
          </div>
          {import.meta.env.DEV ? (
            <>
              <ReactQueryDevtools buttonPosition="bottom-right" />
              <TanStackRouterDevtools position="bottom-right" />
            </>
          ) : null}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

function LoadingIndicator() {
  const isLoading = useRouterState({ select: (s) => s.isLoading })
  return (
    <div
      className={`h-12 transition-all duration-300 ${
        isLoading ? `opacity-100 delay-300` : `opacity-0 delay-0`
      }`}
    >
      <Loader />
    </div>
  )
}
