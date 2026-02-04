import { createServerFn } from "@tanstack/react-start"
import {
  ClawletsConfigSchema,
  GatewayArchitectureSchema,
  loadClawletsConfigRaw,
  writeClawletsConfig,
} from "@clawlets/core/lib/clawlets-config"
import { GatewayIdSchema, PersonaNameSchema } from "@clawlets/shared/lib/identifiers"
import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { runWithEventsAndStatus } from "~/sdk/run-with-events"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function ensureHostGatewayEntry(params: {
  hostCfg: Record<string, unknown>
  gatewayId: string
}): { changed: boolean } {
  const gatewayId = params.gatewayId.trim()
  if (!gatewayId) throw new Error("missing gateway id")

  const gatewaysOrder = Array.isArray(params.hostCfg.gatewaysOrder)
    ? (params.hostCfg.gatewaysOrder as unknown[]).filter((v): v is string => typeof v === "string")
    : []
  const gatewaysRaw = params.hostCfg.gateways
  const gateways = isPlainObject(gatewaysRaw) ? (gatewaysRaw as Record<string, unknown>) : {}

  let changed = false
  if (!Array.isArray(params.hostCfg.gatewaysOrder)) {
    params.hostCfg.gatewaysOrder = gatewaysOrder
    changed = true
  }
  if (!isPlainObject(gatewaysRaw)) {
    params.hostCfg.gateways = gateways
    changed = true
  }

  const inOrder = gatewaysOrder.includes(gatewayId)
  const inGateways = Object.prototype.hasOwnProperty.call(gateways, gatewayId)

  if (inGateways && !isPlainObject(gateways[gatewayId])) {
    throw new Error(`invalid gateway config for ${gatewayId} (expected object)`)
  }

  if (!inOrder) {
    gatewaysOrder.push(gatewayId)
    params.hostCfg.gatewaysOrder = gatewaysOrder
    changed = true
  }

  if (!inGateways) {
    gateways[gatewayId] = {}
    params.hostCfg.gateways = gateways
    changed = true
  }

  return { changed }
}

export const addGateway = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      host: String(d["host"] || ""),
      gatewayId: String(d["gatewayId"] || ""),
      architecture: typeof d["architecture"] === "string" ? d["architecture"] : "",
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.hosts = next.hosts && typeof next.hosts === "object" && !Array.isArray(next.hosts) ? next.hosts : {}
    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")
    const hostCfg = next.hosts[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const gatewayId = data.gatewayId.trim()
    const architecture = data.architecture.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")

    let changed = false
    if (architecture) {
      const parsedArchitecture = GatewayArchitectureSchema.safeParse(architecture)
      if (!parsedArchitecture.success) throw new Error("invalid gateway architecture")
      const existingArch = next.fleet.gatewayArchitecture
      if (existingArch && existingArch !== parsedArchitecture.data) {
        throw new Error(`gateway architecture already set to ${existingArch}`)
      }
      if (!existingArch) {
        next.fleet.gatewayArchitecture = parsedArchitecture.data
        changed = true
      }
    }

    const res = ensureHostGatewayEntry({ hostCfg, gatewayId })
    if (res.changed) changed = true
    next.hosts[hostName] = hostCfg

    if (!changed) return { ok: true as const }

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `gateway add ${hostName}/${gatewayId}`,
      host: hostName,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding gateway ${gatewayId} (host=${hostName})` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const addGatewayAgent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      host: String(d["host"] || ""),
      gatewayId: String(d["gatewayId"] || ""),
      agentId: String(d["agentId"] || ""),
      name: typeof d["name"] === "string" ? d["name"] : "",
      makeDefault: Boolean(d["makeDefault"]),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")
    const gatewayId = data.gatewayId.trim()
    const agentId = data.agentId.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")
    const parsedAgent = PersonaNameSchema.safeParse(agentId)
    if (!parsedAgent.success) throw new Error("invalid agent id")

    const next = structuredClone(raw) as any
    next.hosts = next.hosts && typeof next.hosts === "object" && !Array.isArray(next.hosts) ? next.hosts : {}
    const hostCfg = next.hosts[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    hostCfg.gateways =
      hostCfg.gateways && typeof hostCfg.gateways === "object" && !Array.isArray(hostCfg.gateways) ? hostCfg.gateways : {}
    const gateway = hostCfg.gateways[gatewayId]
    if (!gateway || typeof gateway !== "object") throw new Error(`unknown gateway id: ${gatewayId}`)

    gateway.agents = gateway.agents && typeof gateway.agents === "object" && !Array.isArray(gateway.agents) ? gateway.agents : {}
    gateway.agents.list = Array.isArray(gateway.agents.list) ? gateway.agents.list : []
    const existing = gateway.agents.list.find((entry: any) => entry?.id === agentId)
    if (existing) throw new Error(`agent already exists: ${agentId}`)

    const hasDefault = gateway.agents.list.some((entry: any) => entry?.default === true)
    const makeDefault = data.makeDefault || !hasDefault
    if (makeDefault) {
      gateway.agents.list = gateway.agents.list.map((entry: any) => ({ ...entry, default: false }))
    }
    const entry: Record<string, unknown> = { id: agentId }
    const name = data.name.trim()
    if (name) entry.name = name
    if (makeDefault) entry.default = true
    gateway.agents.list = [...gateway.agents.list, entry]

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `agent add ${hostName}/${gatewayId}/${agentId}`,
      host: hostName,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding agent ${agentId} to ${gatewayId} (host=${hostName})` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeGatewayAgent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      host: String(d["host"] || ""),
      gatewayId: String(d["gatewayId"] || ""),
      agentId: String(d["agentId"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")
    const gatewayId = data.gatewayId.trim()
    const agentId = data.agentId.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")
    const parsedAgent = PersonaNameSchema.safeParse(agentId)
    if (!parsedAgent.success) throw new Error("invalid agent id")

    const next = structuredClone(raw) as any
    next.hosts = next.hosts && typeof next.hosts === "object" && !Array.isArray(next.hosts) ? next.hosts : {}
    const hostCfg = next.hosts[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const gateway = hostCfg.gateways?.[gatewayId]
    if (!gateway || typeof gateway !== "object") throw new Error(`unknown gateway id: ${gatewayId}`)
    const list = Array.isArray(gateway.agents?.list) ? gateway.agents.list : []
    if (!list.some((entry: any) => entry?.id === agentId)) throw new Error(`agent not found: ${agentId}`)
    gateway.agents = gateway.agents && typeof gateway.agents === "object" && !Array.isArray(gateway.agents) ? gateway.agents : {}
    gateway.agents.list = list.filter((entry: any) => entry?.id !== agentId)

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `agent rm ${hostName}/${gatewayId}/${agentId}`,
      host: hostName,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing agent ${agentId} from ${gatewayId} (host=${hostName})` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeGateway = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, host: String(d["host"] || ""), gatewayId: String(d["gatewayId"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")
    const gatewayId = data.gatewayId.trim()
    const next = structuredClone(raw) as any
    next.hosts = next.hosts && typeof next.hosts === "object" && !Array.isArray(next.hosts) ? next.hosts : {}
    const hostCfg = next.hosts[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingOrder = Array.isArray(hostCfg.gatewaysOrder) ? hostCfg.gatewaysOrder : []
    const existingGateways =
      hostCfg.gateways && typeof hostCfg.gateways === "object" && !Array.isArray(hostCfg.gateways) ? hostCfg.gateways : {}
    if (!existingOrder.includes(gatewayId) && !existingGateways[gatewayId]) throw new Error("gateway not found")

    hostCfg.gatewaysOrder = existingOrder.filter((b: string) => b !== gatewayId)
    const gatewaysRecord = { ...existingGateways }
    delete gatewaysRecord[gatewayId]
    hostCfg.gateways = gatewaysRecord
    next.hosts[hostName] = hostCfg
    if (Array.isArray(next.fleet?.codex?.gateways)) {
      const stillExists = Object.entries(next.hosts).some(
        ([name, cfg]) => name !== hostName && Boolean((cfg as any)?.gateways?.[gatewayId]),
      )
      if (!stillExists) {
        next.fleet.codex.gateways = next.fleet.codex.gateways.filter((b: string) => b !== gatewayId)
      }
    }

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `gateway rm ${hostName}/${gatewayId}`,
      host: hostName,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing gateway ${gatewayId} (host=${hostName})` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const setGatewayArchitecture = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      architecture: String(d["architecture"] || ""),
    }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const architecture = data.architecture.trim()
    const parsedArchitecture = GatewayArchitectureSchema.safeParse(architecture)
    if (!parsedArchitecture.success) throw new Error("invalid gateway architecture")

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.gatewayArchitecture = parsedArchitecture.data

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `gateway architecture ${parsedArchitecture.data}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Setting gateway architecture: ${parsedArchitecture.data}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })
