import { createFileRoute, redirect } from "@tanstack/react-router"
import { pickLastActiveProject, readLastProjectSlug, slugifyProjectName, storeLastProjectSlug } from "~/lib/project-routing"
import { projectsListQueryOptions } from "~/lib/query-options"

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const projects = await context.queryClient.ensureQueryData(projectsListQueryOptions())
    const stored = readLastProjectSlug()
    const storedProject = stored
      ? projects.find((project) => slugifyProjectName(project.name) === stored)
      : null
    const next = storedProject || pickLastActiveProject(projects)
    if (!next) {
      throw redirect({
        to: "/projects",
        replace: true,
      })
    }

    const projectSlug = slugifyProjectName(next.name)
    storeLastProjectSlug(projectSlug)
    throw redirect({
      to: "/$projectSlug",
      params: { projectSlug },
      replace: true,
    })
  },
  component: () => null,
})
