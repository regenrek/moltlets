import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/runs/$runId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$projectSlug/~/runs/$runId",
      params: { projectSlug: params.projectSlug, runId: params.runId },
    })
  },
  component: () => null,
})
