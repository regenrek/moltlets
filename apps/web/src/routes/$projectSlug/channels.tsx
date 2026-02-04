import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/channels")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/channels",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
