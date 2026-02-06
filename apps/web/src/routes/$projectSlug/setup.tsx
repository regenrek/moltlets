import { createFileRoute, Outlet } from "@tanstack/react-router"
import { projectsListQueryOptions } from "~/lib/query-options"

export const Route = createFileRoute("/$projectSlug/setup")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(projectsListQueryOptions())
  },
  component: SetupLayout,
})

function SetupLayout() {
  return <Outlet />
}
