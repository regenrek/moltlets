import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/deploy")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/deploy",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})

