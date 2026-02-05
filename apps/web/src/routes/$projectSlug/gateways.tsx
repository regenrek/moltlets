import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/gateways")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/gateways",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
