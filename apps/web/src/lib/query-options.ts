import { convexQuery } from "@convex-dev/react-query"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api.js"
import { getDeployCredsStatus } from "~/sdk/infra"

export const queryKeys = {
  deployCreds: (projectId: Id<"projects"> | null) => ["deployCreds", projectId] as const,
} as const

export function projectsListQueryOptions() {
  return { ...convexQuery(api.controlPlane.projects.list, {}), staleTime: 30_000 }
}

export function projectGetQueryOptions(projectId: Id<"projects">) {
  return { ...convexQuery(api.controlPlane.projects.get, { projectId }), staleTime: 30_000 }
}

export function currentUserQueryOptions() {
  return { ...convexQuery(api.identity.users.getCurrent, {}), staleTime: 60_000 }
}

export function dashboardOverviewQueryOptions() {
  return { ...convexQuery(api.controlPlane.projects.dashboardOverview, {}), staleTime: 30_000 }
}

export function deployCredsQueryOptions(projectId: Id<"projects"> | null) {
  return {
    queryKey: queryKeys.deployCreds(projectId),
    queryFn: async () => await getDeployCredsStatus({ data: { projectId: projectId as Id<"projects"> } }),
    staleTime: 30_000,
  }
}
