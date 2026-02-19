import { convexQuery } from "@convex-dev/react-query"
import type { Id } from "../../convex/_generated/dataModel.js"
import { api } from "../../convex/_generated/api.js"

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
