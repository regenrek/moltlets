import { createServerFn } from "@tanstack/react-start"
import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { parseProjectIdInput } from "~/sdk/runtime"

export type DashboardProjectSummary = (typeof api.controlPlane.projects.dashboardOverview)["_returnType"]["projects"][number]

export type ProjectHostExposure = {
  hostName: string
  enabled: boolean
  sshExposureMode: string
  targetHost: string | null
  tailnetMode: string | null
}

export const getProjectHostExposureSummary = createServerFn({ method: "POST" })
  .inputValidator(parseProjectIdInput)
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const rows = await client.query(api.controlPlane.hosts.listByProject, { projectId: data.projectId })
    const hosts: ProjectHostExposure[] = rows.map((row) => ({
      hostName: row.hostName,
      enabled: row.desired?.enabled !== false,
      sshExposureMode: typeof row.desired?.sshExposureMode === "string" ? row.desired.sshExposureMode : "unknown",
      targetHost: typeof row.desired?.targetHost === "string" && row.desired.targetHost.trim()
        ? row.desired.targetHost.trim()
        : null,
      tailnetMode: typeof row.desired?.tailnetMode === "string" && row.desired.tailnetMode.trim()
        ? row.desired.tailnetMode.trim()
        : null,
    }))
    return { hosts }
  })
