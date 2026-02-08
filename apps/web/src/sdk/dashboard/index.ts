import { createServerFn } from "@tanstack/react-start"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { createConvexClient } from "~/server/convex"
import { parseProjectIdInput } from "~/sdk/runtime"

type DashboardProjectConfigSummary = {
  configPath: string | null
  configMtimeMs: number | null
  gatewaysTotal: number
  gatewayIdsPreview: string[]
  hostsTotal: number
  hostsEnabled: number
  defaultHost: string | null
  codexEnabled: boolean
  resticEnabled: boolean
  error: string | null
}

export type DashboardProjectSummary = {
  projectId: Id<"projects">
  name: string
  status: "creating" | "ready" | "error"
  executionMode: "local" | "remote_runner"
  workspaceRef: { kind: "local" | "git"; id: string; relPath?: string }
  localPath: string | null
  updatedAt: number
  lastSeenAt: number | null
  cfg: DashboardProjectConfigSummary
}

export const getDashboardOverview = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (data === undefined || data === null) return {}
    if (!data || typeof data !== "object") throw new Error("invalid input")
    return {}
  })
  .handler(async () => {
    const client = createConvexClient()
    const projects = await client.query(api.controlPlane.projects.list, {})

    const summaries = await Promise.all(
      projects.map(async (p): Promise<DashboardProjectSummary> => {
        const base = {
          projectId: p._id as Id<"projects">,
          name: p.name,
          status: p.status,
          executionMode: p.executionMode,
          workspaceRef: p.workspaceRef,
          localPath: typeof p.localPath === "string" && p.localPath.trim() ? p.localPath : null,
          updatedAt: p.updatedAt,
          lastSeenAt: typeof p.lastSeenAt === "number" ? p.lastSeenAt : null,
        }

        try {
          const [projectConfigs, hosts] = await Promise.all([
            client.query(api.controlPlane.projectConfigs.listByProject, { projectId: p._id as Id<"projects"> }),
            client.query(api.controlPlane.hosts.listByProject, { projectId: p._id as Id<"projects"> }),
          ])
          if (projectConfigs.length > 0 || hosts.length > 0) {
            const fleetCfg = projectConfigs.find((row) => row.type === "fleet") ?? projectConfigs[0] ?? null
            const configMtimeMs = projectConfigs.reduce<number | null>((acc, row) => {
              const value = typeof row.lastSyncAt === "number" ? row.lastSyncAt : null
              if (value === null) return acc
              if (acc === null) return value
              return Math.max(acc, value)
            }, null)
            const hostsEnabled = hosts.filter((row) => row.desired?.enabled === true).length
            const gatewaysTotal = hosts.reduce((total, row) => {
              const count = row.desired?.gatewayCount
              return total + (typeof count === "number" && Number.isFinite(count) ? count : 0)
            }, 0)
            const defaultHost = hosts[0]?.hostName ?? null
            const firstError = projectConfigs.find((row) => typeof row.lastError === "string" && row.lastError.trim())
            return {
              ...base,
              cfg: {
                configPath: fleetCfg?.path ?? null,
                configMtimeMs,
                gatewaysTotal,
                gatewayIdsPreview: [],
                hostsTotal: hosts.length,
                hostsEnabled,
                defaultHost,
                codexEnabled: false,
                resticEnabled: false,
                error: firstError?.lastError ?? null,
              },
            }
          }

          return {
            ...base,
            cfg: {
              configPath: null,
              configMtimeMs: null,
              gatewaysTotal: 0,
              gatewayIdsPreview: [],
              hostsTotal: 0,
              hostsEnabled: 0,
              defaultHost: null,
              codexEnabled: false,
              resticEnabled: false,
              error: null,
            },
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            ...base,
            cfg: {
              configPath: null,
              configMtimeMs: null,
              gatewaysTotal: 0,
              gatewayIdsPreview: [],
              hostsTotal: 0,
              hostsEnabled: 0,
              defaultHost: null,
              codexEnabled: false,
              resticEnabled: false,
              error: message,
            },
          }
        }
      }),
    )

    return { projects: summaries }
  })

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
