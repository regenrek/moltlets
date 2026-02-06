import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/bootstrap")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/hosts/$host/deploy",
      params: { projectSlug: params.projectSlug, host: params.host },
    })
  },
  component: () => null,
})

