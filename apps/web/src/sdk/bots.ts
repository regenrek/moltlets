import { createServerFn } from "@tanstack/react-start"
import { applySecurityDefaults } from "@clawlets/core/lib/config-patch"
import { applyCapabilityPreset, getChannelCapabilityPreset, type CapabilityPreset } from "@clawlets/core/lib/capability-presets"
import { diffConfig, type ConfigDiffEntry } from "@clawlets/core/lib/config-diff"
import { validateClawdbotConfig } from "@clawlets/core/lib/clawdbot-schema-validate"
import { diffChannelSchemasFromArtifacts } from "@clawlets/core/lib/clawdbot-schema-diff"
import { getPinnedClawdbotSchema } from "@clawlets/core/lib/clawdbot-schema"
import { suggestSecretNameForEnvVar } from "@clawlets/core/lib/fleet-secrets-plan-helpers"
import { lintOpenclawSecurityConfig } from "@clawlets/core/lib/openclaw-security-lint"
import {
  ClawletsConfigSchema,
  loadClawletsConfigRaw,
  writeClawletsConfig,
} from "@clawlets/core/lib/clawlets-config"

import { api } from "../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { readClawletsEnvTokens } from "~/server/redaction"
import { getAdminProjectContext } from "~/sdk/repo-root"
import {
  parseBotOpenclawConfigInput,
  parseBotCapabilityPresetInput,
  parseBotCapabilityPresetPreviewInput,
  parseProjectBotInput,
  parseProjectHostBotInput,
} from "~/sdk/serverfn-validators"
import { mapValidationIssues, runWithEventsAndStatus, type ValidationIssue } from "~/sdk/run-with-events"
import { sanitizeErrorMessage } from "@clawlets/core/lib/safe-error"

export const LIVE_SCHEMA_ERROR_FALLBACK = "Unable to fetch schema. Check logs."

type RunFailure = { ok: false; issues: ValidationIssue[] }

export function sanitizeLiveSchemaError(err: unknown): string {
  return sanitizeErrorMessage(err, LIVE_SCHEMA_ERROR_FALLBACK)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function buildEffectiveOpenclawConfig(bot: Record<string, unknown>): Record<string, unknown> {
  const openclaw = isPlainObject(bot["openclaw"]) ? (bot["openclaw"] as Record<string, unknown>) : {}
  const out: Record<string, unknown> = { ...openclaw }
  const channels = bot["channels"]
  const agents = bot["agents"]
  const hooks = bot["hooks"]
  const skills = bot["skills"]
  const plugins = bot["plugins"]
  if (isPlainObject(channels)) out["channels"] = channels
  if (isPlainObject(agents)) out["agents"] = agents
  if (isPlainObject(hooks)) out["hooks"] = hooks
  if (isPlainObject(skills)) out["skills"] = skills
  if (isPlainObject(plugins)) out["plugins"] = plugins
  return out
}

function resolvePreset(kind: string, presetId: string): CapabilityPreset {
  if (kind === "channel") return getChannelCapabilityPreset(presetId)
  throw new Error("unsupported preset kind")
}

function ensureSecretEnvMapping(params: {
  secretEnv: Record<string, unknown>
  envVar: string
  botId: string
}): void {
  const envVar = params.envVar.trim()
  if (!envVar) return
  const existing = params.secretEnv[envVar]
  if (typeof existing === "string" && existing.trim()) return
  params.secretEnv[envVar] = suggestSecretNameForEnvVar(envVar, params.botId)
}

function ensureBotProfileSecretEnv(bot: Record<string, unknown>): Record<string, unknown> {
  const profile = isPlainObject(bot.profile) ? (bot.profile as Record<string, unknown>) : {}
  bot.profile = profile
  const secretEnv = isPlainObject(profile.secretEnv) ? (profile.secretEnv as Record<string, unknown>) : {}
  profile.secretEnv = secretEnv
  return secretEnv
}

function mapSchemaIssues(issues: Array<{ path: Array<string | number>; message: string }>): ValidationIssue[] {
  return issues.map((issue) => ({
    code: "schema",
    path: issue.path,
    message: issue.message,
  }))
}

function mapSchemaFailure(message: string): ValidationIssue[] {
  return [{ code: "schema", path: [], message }]
}

export const setBotOpenclawConfig = createServerFn({ method: "POST" })
  .inputValidator(parseBotOpenclawConfigInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const hostName = data.host.trim()

    if (!isPlainObject(data.openclaw)) throw new Error("openclaw config must be a JSON object")

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const hostCfg = next?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingBot = hostCfg?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    existingBot.openclaw = data.openclaw

    const schemaMode = data.schemaMode === "live" ? "live" : "pinned"
    let schema: Record<string, unknown> | undefined = undefined
    if (schemaMode === "live") {
      try {
        const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
        const live = await fetchOpenclawSchemaLive({
          projectId: data.projectId,
          host: data.host,
          botId,
        })
        if (!live.ok) {
          return { ok: false as const, issues: [{ code: "schema", path: [], message: live.message }] satisfies ValidationIssue[] }
        }
        schema = live.schema.schema as Record<string, unknown>
      } catch (err) {
        const message = sanitizeLiveSchemaError(err)
        console.error("setBotOpenclawConfig live schema failed", message)
        return {
          ok: false as const,
          issues: mapSchemaFailure(message),
        }
      }
    }

    const schemaValidation = validateClawdbotConfig(existingBot.openclaw, schema)
    if (!schemaValidation.ok) {
      return {
        ok: false as const,
        issues: mapSchemaIssues(schemaValidation.issues),
      }
    }

    const securityReport = lintOpenclawSecurityConfig({ openclaw: existingBot.openclaw, gatewayId: botId })
    const inlineSecrets = securityReport.findings.filter((f) => f.id.startsWith("inlineSecret."))
    if (inlineSecrets.length > 0) {
      return {
        ok: false as const,
        issues: inlineSecrets.slice(0, 20).map((f) => ({
          code: "security",
          path: f.id
            .slice("inlineSecret.".length)
            .split(".")
            .filter(Boolean),
          message: f.detail,
        })),
      }
    }

    const validated = ClawletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot ${hostName}/${botId} openclaw config`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bot.openclaw.write",
      target: { botId },
      data: { runId },
    })

    type SetOpenclawResult = { ok: true; runId: typeof runId } | RunFailure

    return await runWithEventsAndStatus<SetOpenclawResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating hosts.${hostName}.bots.${botId}.openclaw` })
        await writeClawletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })

export const applyBotCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseBotCapabilityPresetInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const hostName = data.host.trim()
    const preset = resolvePreset(data.kind, data.presetId)

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const hostCfg = next?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingBot = hostCfg?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    let warnings: string[] = []
    try {
      const result = applyCapabilityPreset({ openclaw: existingBot.openclaw, channels: existingBot.channels, preset })
      existingBot.openclaw = result.openclaw
      existingBot.channels = result.channels
      warnings = result.warnings
      const secretEnv = ensureBotProfileSecretEnv(existingBot)
      for (const envVar of result.requiredEnv) {
        ensureSecretEnvMapping({ secretEnv, envVar, botId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const effectiveConfig = buildEffectiveOpenclawConfig(existingBot as Record<string, unknown>)
    const schemaValidation = validateClawdbotConfig(effectiveConfig)
    if (!schemaValidation.ok) {
      return { ok: false as const, issues: mapSchemaIssues(schemaValidation.issues) }
    }

    if (data.schemaMode === "live") {
      try {
        const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
        const live = await fetchOpenclawSchemaLive({
          projectId: data.projectId,
          host: data.host,
          botId,
        })
        if (!live.ok) {
          return { ok: false as const, issues: mapSchemaFailure(live.message || LIVE_SCHEMA_ERROR_FALLBACK) }
        }
        const liveValidation = validateClawdbotConfig(effectiveConfig, live.schema.schema as Record<string, unknown>)
        if (!liveValidation.ok) {
          return { ok: false as const, issues: mapSchemaIssues(liveValidation.issues) }
        }
      } catch (err) {
        const message = sanitizeLiveSchemaError(err)
        return { ok: false as const, issues: mapSchemaFailure(message) }
      }
    }

    const validated = ClawletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot ${hostName}/${botId} preset ${preset.id}`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bot.preset.apply",
      target: { botId },
      data: { preset: preset.id, runId, warnings },
    })

    type ApplyPresetResult = { ok: true; runId: typeof runId; warnings: string[] } | RunFailure

    return await runWithEventsAndStatus<ApplyPresetResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Applying ${preset.id} preset for ${botId} (host=${hostName})` })
        for (const w of warnings) await emit({ level: "warn", message: w })
        await writeClawletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId, warnings }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })

export const previewBotCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseBotCapabilityPresetPreviewInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const hostName = data.host.trim()
    const preset = resolvePreset(data.kind, data.presetId)
    const { config: raw } = loadClawletsConfigRaw({
      repoRoot: (await getAdminProjectContext(createConvexClient(), data.projectId)).repoRoot,
    })
    const hostCfg = (raw as any)?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingBot = (hostCfg as any)?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const nextBot = structuredClone(existingBot) as Record<string, unknown>
    let warnings: string[] = []
    let requiredEnv: string[] = []
    try {
      const result = applyCapabilityPreset({ openclaw: (nextBot as any).openclaw, channels: (nextBot as any).channels, preset })
      ;(nextBot as any).openclaw = result.openclaw
      ;(nextBot as any).channels = result.channels
      warnings = result.warnings
      requiredEnv = result.requiredEnv
      const secretEnv = ensureBotProfileSecretEnv(nextBot)
      for (const envVar of result.requiredEnv) {
        ensureSecretEnvMapping({ secretEnv, envVar, botId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const schemaValidation = validateClawdbotConfig(buildEffectiveOpenclawConfig(nextBot))
    const diff = diffConfig(existingBot, nextBot, `hosts.${hostName}.bots.${botId}`)

    return {
      ok: true as const,
      diff: diff as ConfigDiffEntry[],
      warnings,
      requiredEnv,
      issues: schemaValidation.ok ? [] : mapSchemaIssues(schemaValidation.issues),
    }
  })

export const verifyBotOpenclawSchema = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostBotInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const hostName = data.host.trim()
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config: raw } = loadClawletsConfigRaw({ repoRoot })
    const hostCfg = (raw as any)?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingBot = (hostCfg as any)?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const pinned = getPinnedClawdbotSchema()
    let liveSchema: Record<string, unknown> | null = null
    try {
      const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
        const live = await fetchOpenclawSchemaLive({
          projectId: data.projectId,
          host: hostName,
          botId,
        })
      if (!live.ok) {
        return { ok: false as const, issues: mapSchemaFailure(live.message || LIVE_SCHEMA_ERROR_FALLBACK) }
      }
      liveSchema = live.schema.schema as Record<string, unknown>
      const liveValidation = validateClawdbotConfig((existingBot as any).openclaw, liveSchema)
      return {
        ok: true as const,
        issues: liveValidation.ok ? [] : mapSchemaIssues(liveValidation.issues),
        schemaDiff: diffChannelSchemasFromArtifacts(pinned, live.schema),
        liveVersion: live.schema.version,
        pinnedVersion: pinned.version,
      }
    } catch (err) {
      const message = sanitizeLiveSchemaError(err)
      return { ok: false as const, issues: mapSchemaFailure(message) }
    }
  })

export const hardenBotOpenclawConfig = createServerFn({ method: "POST" })
  .inputValidator(parseProjectBotInput)
  .handler(async ({ data }) => {
    const botId = data.botId.trim()
    const hostName = data.host.trim()

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const hostCfg = next?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingBot = hostCfg?.bots?.[botId]
    if (!existingBot || typeof existingBot !== "object") throw new Error("bot not found")

    const hardened = applySecurityDefaults({ openclaw: existingBot.openclaw, channels: existingBot.channels })
    if (hardened.changes.length === 0) return { ok: true as const, changes: [], warnings: [] }

    existingBot.openclaw = hardened.openclaw
    existingBot.channels = hardened.channels
    const validated = ClawletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `bot ${hostName}/${botId} openclaw harden`,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "bot.openclaw.harden",
      target: { botId },
      data: { runId, changes: hardened.changes, warnings: hardened.warnings },
    })

    type HardenResult = {
      ok: true
      runId: typeof runId
      changes: typeof hardened.changes
      warnings: typeof hardened.warnings
    } | RunFailure

    return await runWithEventsAndStatus<HardenResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Hardening hosts.${hostName}.bots.${botId}` })
        for (const w of hardened.warnings) await emit({ level: "warn", message: w })
        await writeClawletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId, changes: hardened.changes, warnings: hardened.warnings }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })
