import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/~/server-logs")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/logs",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
