import { createServerFn } from "@tanstack/react-start"
import {
  GatewayArchitectureSchema,
} from "@clawlets/core/lib/config/clawlets-config"
import { GatewayIdSchema, PersonaNameSchema } from "@clawlets/shared/lib/identifiers"
import { parseProjectIdInput } from "~/sdk/runtime"
import { configDotBatch, configDotGet, configDotSet } from "./dot"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean)
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
    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")

    const gatewayId = data.gatewayId.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")

    const hostNode = await configDotGet({
      data: { projectId: data.projectId, path: `hosts.${hostName}` },
    })
    if (!isPlainObject(hostNode.value)) {
      throw new Error(`unknown host: ${hostName}`)
    }

    const hostCfg = structuredClone(hostNode.value) as Record<string, unknown>
    const res = ensureHostGatewayEntry({ hostCfg, gatewayId })

    const ops: Array<{ path: string; value?: string; valueJson?: string; del: boolean }> = []
    const architecture = data.architecture.trim()
    if (architecture) {
      const parsedArchitecture = GatewayArchitectureSchema.safeParse(architecture)
      if (!parsedArchitecture.success) throw new Error("invalid gateway architecture")
      const existingArchNode = await configDotGet({
        data: { projectId: data.projectId, path: "fleet.gatewayArchitecture" },
      })
      const existingArch = typeof existingArchNode.value === "string" ? existingArchNode.value.trim() : ""
      if (existingArch && existingArch !== parsedArchitecture.data) {
        throw new Error(`gateway architecture already set to ${existingArch}`)
      }
      if (!existingArch) {
        ops.push({
          path: "fleet.gatewayArchitecture",
          value: parsedArchitecture.data,
          del: false,
        })
      }
    }

    if (!res.changed && ops.length === 0) return { ok: true as const }

    const nextOrder = asStringArray(hostCfg.gatewaysOrder)
    const gateways = isPlainObject(hostCfg.gateways) ? hostCfg.gateways : {}
    const gateway = isPlainObject(gateways[gatewayId]) ? gateways[gatewayId] : {}

    ops.push(
      {
        path: `hosts.${hostName}.gatewaysOrder`,
        valueJson: JSON.stringify(nextOrder),
        del: false,
      },
      {
        path: `hosts.${hostName}.gateways.${gatewayId}`,
        valueJson: JSON.stringify(gateway),
        del: false,
      },
    )

    return await configDotBatch({
      data: {
        projectId: data.projectId,
        ops,
      },
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
    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")

    const gatewayId = data.gatewayId.trim()
    const agentId = data.agentId.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")
    const parsedAgent = PersonaNameSchema.safeParse(agentId)
    if (!parsedAgent.success) throw new Error("invalid agent id")

    const gatewayNode = await configDotGet({
      data: { projectId: data.projectId, path: `hosts.${hostName}.gateways.${gatewayId}` },
    })
    if (!isPlainObject(gatewayNode.value)) {
      throw new Error(`unknown gateway id: ${gatewayId}`)
    }

    const gateway = structuredClone(gatewayNode.value) as Record<string, unknown>
    gateway.agents = isPlainObject(gateway.agents) ? gateway.agents : {}
    const agents = gateway.agents as Record<string, unknown>
    const list = Array.isArray(agents.list) ? (agents.list as Array<Record<string, unknown>>) : []
    if (list.some((entry) => String(entry?.id || "") === agentId)) {
      throw new Error(`agent already exists: ${agentId}`)
    }

    const hasDefault = list.some((entry) => entry?.default === true)
    const makeDefault = data.makeDefault || !hasDefault
    const nextList: Array<Record<string, unknown>> = makeDefault
      ? list.map((entry) => ({ ...entry, default: false } as Record<string, unknown>))
      : [...list]

    const entry: Record<string, unknown> = { id: agentId }
    const name = data.name.trim()
    if (name) entry.name = name
    if (makeDefault) entry.default = true
    nextList.push(entry)

    return await configDotSet({
      data: {
        projectId: data.projectId,
        path: `hosts.${hostName}.gateways.${gatewayId}.agents.list`,
        valueJson: JSON.stringify(nextList),
      },
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
    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")

    const gatewayId = data.gatewayId.trim()
    const agentId = data.agentId.trim()
    const parsedGateway = GatewayIdSchema.safeParse(gatewayId)
    if (!parsedGateway.success) throw new Error("invalid gateway id")
    const parsedAgent = PersonaNameSchema.safeParse(agentId)
    if (!parsedAgent.success) throw new Error("invalid agent id")

    const listNode = await configDotGet({
      data: { projectId: data.projectId, path: `hosts.${hostName}.gateways.${gatewayId}.agents.list` },
    })
    const list = Array.isArray(listNode.value) ? (listNode.value as Array<Record<string, unknown>>) : []
    if (!list.some((entry) => String(entry?.id || "") === agentId)) {
      throw new Error(`agent not found: ${agentId}`)
    }

    const nextList = list.filter((entry) => String(entry?.id || "") !== agentId)
    return await configDotSet({
      data: {
        projectId: data.projectId,
        path: `hosts.${hostName}.gateways.${gatewayId}.agents.list`,
        valueJson: JSON.stringify(nextList),
      },
    })
  })

export const removeGateway = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, host: String(d["host"] || ""), gatewayId: String(d["gatewayId"] || "") }
  })
  .handler(async ({ data }) => {
    const hostName = data.host.trim()
    if (!hostName) throw new Error("missing host")

    const gatewayId = data.gatewayId.trim()
    const hostNode = await configDotGet({
      data: { projectId: data.projectId, path: `hosts.${hostName}` },
    })
    if (!isPlainObject(hostNode.value)) {
      throw new Error(`unknown host: ${hostName}`)
    }

    const hostCfg = hostNode.value as Record<string, unknown>
    const existingOrder = asStringArray(hostCfg.gatewaysOrder)
    const existingGateways = isPlainObject(hostCfg.gateways) ? hostCfg.gateways : {}
    if (!existingOrder.includes(gatewayId) && !existingGateways[gatewayId]) {
      throw new Error("gateway not found")
    }

    const nextOrder = existingOrder.filter((entry) => entry !== gatewayId)
    const ops: Array<{ path: string; value?: string; valueJson?: string; del: boolean }> = [
      {
        path: `hosts.${hostName}.gatewaysOrder`,
        valueJson: JSON.stringify(nextOrder),
        del: false,
      },
      {
        path: `hosts.${hostName}.gateways.${gatewayId}`,
        del: true,
      },
    ]

    const [hostsNode, codexGatewaysNode] = await Promise.all([
      configDotGet({ data: { projectId: data.projectId, path: "hosts" } }),
      configDotGet({ data: { projectId: data.projectId, path: "fleet.codex.gateways" } }),
    ])
    const codexGateways = asStringArray(codexGatewaysNode.value)
    if (codexGateways.includes(gatewayId)) {
      const allHosts = isPlainObject(hostsNode.value)
        ? (hostsNode.value as Record<string, unknown>)
        : {}
      let stillExists = false
      for (const [name, cfg] of Object.entries(allHosts)) {
        if (name === hostName) continue
        if (!isPlainObject(cfg)) continue
        const gateways = isPlainObject(cfg.gateways) ? cfg.gateways : {}
        if (gateways[gatewayId]) {
          stillExists = true
          break
        }
      }
      if (!stillExists) {
        ops.push({
          path: "fleet.codex.gateways",
          valueJson: JSON.stringify(codexGateways.filter((entry) => entry !== gatewayId)),
          del: false,
        })
      }
    }

    return await configDotBatch({
      data: {
        projectId: data.projectId,
        ops,
      },
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
    const architecture = data.architecture.trim()
    const parsedArchitecture = GatewayArchitectureSchema.safeParse(architecture)
    if (!parsedArchitecture.success) throw new Error("invalid gateway architecture")
    return await configDotSet({
      data: {
        projectId: data.projectId,
        path: "fleet.gatewayArchitecture",
        value: parsedArchitecture.data,
      },
    })
  })
