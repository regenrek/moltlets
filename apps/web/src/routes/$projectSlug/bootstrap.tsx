import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/bootstrap")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/bootstrap",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
