import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/secrets")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/secrets",
      params: { projectSlug: params.projectSlug },
    })
  },
  component: () => null,
})
