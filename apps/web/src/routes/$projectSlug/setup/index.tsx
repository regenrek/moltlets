import { convexQuery } from "@convex-dev/react-query"
import { api } from "../../../../convex/_generated/api"
import { createFileRoute, redirect } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"

export const Route = createFileRoute("/$projectSlug/setup/")({
  loader: async ({ context, params }) => {
    const projects = (await context.queryClient.ensureQueryData(projectsListQueryOptions())) as Array<any>
    const project = projects.find((item) => slugifyProjectName(String(item?.name || "")) === params.projectSlug) || null
    const projectId = project?._id ?? null

    if (!projectId || project?.status !== "ready") {
      throw redirect({
        to: "/$projectSlug/hosts",
        params: { projectSlug: params.projectSlug },
      })
    }

    const hosts = await context.queryClient.ensureQueryData(
      convexQuery(api.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
    )
    const hostNames = hosts.map((row) => row.hostName).sort()
    const defaultHost = hostNames[0] ?? null

    if (!defaultHost) {
      throw redirect({
        to: "/$projectSlug/hosts",
        params: { projectSlug: params.projectSlug },
      })
    }

    throw redirect({
      to: "/$projectSlug/hosts/$host/setup",
      params: { projectSlug: params.projectSlug, host: defaultHost },
    })
  },
  component: () => null,
})
