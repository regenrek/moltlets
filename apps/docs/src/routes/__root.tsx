import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import * as React from "react";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import appCss from "@/styles/app.css?url";
import { ThemeInitScript } from "@/components/theme-init-script";
import { ThemeProvider } from "@/components/theme-provider";
import { getTheme, type Theme } from "@/lib/theme";
import { DefaultCatchBoundary } from "@/components/DefaultCatchBoundary";
import { NotFound } from "@/components/NotFound";

export const Route = createRootRoute({
  loader: () => getTheme(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Clawlets Docs" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/logo.png" },
      { rel: "apple-touch-icon", href: "/logo.png" },
    ],
  }),
  errorComponent: (props) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme;
  return (
    <html
      lang="en"
      className={initial === "system" ? "" : initial}
      suppressHydrationWarning
    >
      <head>
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <ThemeProvider initial={initial}>
          <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
