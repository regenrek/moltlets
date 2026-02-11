import { convexQuery } from "@convex-dev/react-query"
import { api } from "../../../../convex/_generated/api"
import { createFileRoute, redirect } from "@tanstack/react-router"
import type { Id } from "../../../../convex/_generated/dataModel"
import { projectsListQueryOptions } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"
import { resolveSetupHost } from "~/lib/setup/setup-entry"

export const Route = createFileRoute("/$projectSlug/setup/")({
  loader: async ({ context, params }) => {
    const projects = (await context.queryClient.ensureQueryData(projectsListQueryOptions())) as Array<any>
    const project = projects.find((item) => slugifyProjectName(String(item?.name || "")) === params.projectSlug) || null
    const projectId = project?._id ?? null

    const status = project?.status
    if (!projectId || (status !== "ready" && status !== "creating")) {
      throw redirect({
        to: "/$projectSlug/hosts",
        params: { projectSlug: params.projectSlug },
      })
    }

    let defaultHost: string
    if (status === "ready") {
      const hosts = (await context.queryClient.ensureQueryData(
        convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
      )) as Array<{ hostName: string }>
      defaultHost = resolveSetupHost(hosts.map((row) => row.hostName))
    } else {
      defaultHost = resolveSetupHost([])
    }

    throw redirect({
      to: "/$projectSlug/hosts/$host/setup" as any,
      params: { projectSlug: params.projectSlug, host: defaultHost },
    } as any)
  },
  component: () => null,
})
