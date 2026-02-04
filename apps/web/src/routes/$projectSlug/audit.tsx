import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/audit")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/audit",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
