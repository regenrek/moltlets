import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/updates")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/updates",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
