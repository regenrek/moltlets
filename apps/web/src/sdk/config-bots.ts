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

export function ensureHostBotEntry(params: { hostCfg: Record<string, unknown>; botId: string }): { changed: boolean } {
  const botId = params.botId.trim()
  if (!botId) throw new Error("missing bot id")

  const botsOrder = Array.isArray(params.hostCfg.botsOrder) ? (params.hostCfg.botsOrder as unknown[]).filter((v): v is string => typeof v === "string") : []
  const botsRaw = params.hostCfg.bots
  const bots = isPlainObject(botsRaw) ? (botsRaw as Record<string, unknown>) : {}

  let changed = false
  if (!Array.isArray(params.hostCfg.botsOrder)) {
    params.hostCfg.botsOrder = botsOrder
    changed = true
  }
  if (!isPlainObject(botsRaw)) {
    params.hostCfg.bots = bots
    changed = true
  }

  const inOrder = botsOrder.includes(botId)
  const inBots = Object.prototype.hasOwnProperty.call(bots, botId)

  if (inBots && !isPlainObject(bots[botId])) {
    throw new Error(`invalid bot config for ${botId} (expected object)`)
  }

  if (!inOrder) {
    botsOrder.push(botId)
    params.hostCfg.botsOrder = botsOrder
    changed = true
  }

  if (!inBots) {
    bots[botId] = {}
    params.hostCfg.bots = bots
    changed = true
  }

  return { changed }
}

export const addBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      host: String(d["host"] || ""),
      bot: String(d["bot"] || ""),
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
    const botId = data.bot.trim()
    const architecture = data.architecture.trim()
    const parsedBot = GatewayIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid bot id")
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

    const res = ensureHostBotEntry({ hostCfg, botId })
    if (res.changed) changed = true
    next.hosts[hostName] = hostCfg

    if (!changed) return { ok: true as const }

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot add ${hostName}/${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding bot ${botId} (host=${hostName})` })
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
    hostCfg.bots = hostCfg.bots && typeof hostCfg.bots === "object" && !Array.isArray(hostCfg.bots) ? hostCfg.bots : {}
    const gateway = hostCfg.bots[gatewayId]
    if (!gateway || typeof gateway !== "object") throw new Error(`unknown bot id: ${gatewayId}`)

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
    const gateway = hostCfg.bots?.[gatewayId]
    if (!gateway || typeof gateway !== "object") throw new Error(`unknown bot id: ${gatewayId}`)
    const list = Array.isArray(gateway.agents?.list) ? gateway.agents.list : []
    if (!list.some((entry: any) => entry?.id === agentId)) throw new Error(`agent not found: ${agentId}`)
    gateway.agents = gateway.agents && typeof gateway.agents === "object" && !Array.isArray(gateway.agents) ? gateway.agents : {}
    gateway.agents.list = list.filter((entry: any) => entry?.id !== agentId)

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `agent rm ${hostName}/${gatewayId}/${agentId}`,
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

export const removeBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, host: String(d["host"] || ""), bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")
    const botId = data.bot.trim()
    const next = structuredClone(raw) as any
    next.hosts = next.hosts && typeof next.hosts === "object" && !Array.isArray(next.hosts) ? next.hosts : {}
    const hostCfg = next.hosts[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingOrder = Array.isArray(hostCfg.botsOrder) ? hostCfg.botsOrder : []
    const existingBots =
      hostCfg.bots && typeof hostCfg.bots === "object" && !Array.isArray(hostCfg.bots) ? hostCfg.bots : {}
    if (!existingOrder.includes(botId) && !existingBots[botId]) throw new Error("bot not found")

    hostCfg.botsOrder = existingOrder.filter((b: string) => b !== botId)
    const botsRecord = { ...existingBots }
    delete botsRecord[botId]
    hostCfg.bots = botsRecord
    next.hosts[hostName] = hostCfg
    if (Array.isArray(next.fleet?.codex?.bots)) {
      const stillExists = Object.entries(next.hosts).some(
        ([name, cfg]) => name !== hostName && Boolean((cfg as any)?.bots?.[botId]),
      )
      if (!stillExists) {
        next.fleet.codex.bots = next.fleet.codex.bots.filter((b: string) => b !== botId)
      }
    }

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot rm ${hostName}/${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing bot ${botId} (host=${hostName})` })
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
