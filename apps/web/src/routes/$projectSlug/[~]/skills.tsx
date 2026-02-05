import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/~/skills")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/setup/fleet",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
