import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/restart")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/restart",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
