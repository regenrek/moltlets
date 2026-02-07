import { createFileRoute, redirect } from "@tanstack/react-router"
import { clawletsConfigQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
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

    const cfg = await context.queryClient.ensureQueryData(clawletsConfigQueryOptions(projectId))
    const config = (cfg as any)?.config
    const hostNames = config?.hosts && typeof config.hosts === "object" ? Object.keys(config.hosts).sort() : []
    const defaultHost = typeof config?.defaultHost === "string" && hostNames.includes(config.defaultHost)
      ? config.defaultHost
      : (hostNames[0] ?? null)

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
