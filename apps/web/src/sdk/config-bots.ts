import { createServerFn } from "@tanstack/react-start"
import {
  ClawletsConfigSchema,
  loadClawletsConfigRaw,
  writeClawletsConfig,
} from "@clawlets/core/lib/clawlets-config"
import { GatewayIdSchema } from "@clawlets/shared/lib/identifiers"
import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import { runWithEventsAndStatus } from "~/sdk/run-with-events"
import { parseProjectIdInput } from "~/sdk/serverfn-validators"

export const addBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const botId = data.bot.trim()
    const parsedBot = GatewayIdSchema.safeParse(botId)
    if (!parsedBot.success) throw new Error("invalid gateway id")

    const next = structuredClone(raw) as any
    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.gatewayOrder = Array.isArray(next.fleet.gatewayOrder) ? next.fleet.gatewayOrder : []
    next.fleet.gateways =
      next.fleet.gateways && typeof next.fleet.gateways === "object" && !Array.isArray(next.fleet.gateways)
        ? next.fleet.gateways
        : {}
    if (next.fleet.gatewayOrder.includes(botId) || next.fleet.gateways[botId]) return { ok: true as const }
    next.fleet.gatewayOrder = [...next.fleet.gatewayOrder, botId]
    // New bots should be channel-agnostic by default.
    // Integrations can be enabled later via per-bot config (and then wire secrets as needed).
    next.fleet.gateways[botId] = {}

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot add ${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Adding bot ${botId}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })

export const removeBot = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return { ...base, bot: String(d["bot"] || "") }
  })
  .handler(async ({ data }) => {
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const botId = data.bot.trim()
    const next = structuredClone(raw) as any
    const existingOrder = Array.isArray(next?.fleet?.gatewayOrder) ? next.fleet.gatewayOrder : []
    const existingGateways =
      next?.fleet?.gateways && typeof next.fleet.gateways === "object" && !Array.isArray(next.fleet.gateways)
        ? next.fleet.gateways
        : {}
    if (!existingOrder.includes(botId) && !existingGateways[botId]) throw new Error("bot not found")

    next.fleet = next.fleet && typeof next.fleet === "object" && !Array.isArray(next.fleet) ? next.fleet : {}
    next.fleet.gatewayOrder = existingOrder.filter((b: string) => b !== botId)
    const gatewaysRecord = { ...existingGateways }
    delete gatewaysRecord[botId]
    next.fleet.gateways = gatewaysRecord
    if (Array.isArray(next.fleet.codex?.gateways)) {
      next.fleet.codex.gateways = next.fleet.codex.gateways.filter((b: string) => b !== botId)
    }

    const validated = ClawletsConfigSchema.parse(next)
    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot rm ${botId}`,
    })
    return await runWithEventsAndStatus({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Removing bot ${botId}` })
        await writeClawletsConfig({ configPath, config: validated })
      },
      onSuccess: () => ({ ok: true as const, runId }),
    })
  })
