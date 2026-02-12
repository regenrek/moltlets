import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/settings/vpn")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/hosts/$host/settings",
      params: { projectSlug: params.projectSlug, host: params.host },
    })
  },
  component: () => null,
})
