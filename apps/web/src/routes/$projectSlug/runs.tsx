import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/runs")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/runs",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
