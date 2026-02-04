import { createServerFn } from "@tanstack/react-start"
import { applySecurityDefaults } from "@clawlets/core/lib/config-patch"
import { applyCapabilityPreset, getChannelCapabilityPreset, type CapabilityPreset } from "@clawlets/core/lib/capability-presets"
import { diffConfig, type ConfigDiffEntry } from "@clawlets/core/lib/config-diff"
import { validateClawdbotConfig } from "@clawlets/core/lib/clawdbot-schema-validate"
import { diffChannelSchemasFromArtifacts } from "@clawlets/core/lib/clawdbot-schema-diff"
import { getPinnedClawdbotSchema } from "@clawlets/core/lib/clawdbot-schema"
import { OPENCLAW_DEFAULT_COMMANDS } from "@clawlets/core/lib/openclaw-defaults"
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
  parseGatewayOpenclawConfigInput,
  parseGatewayCapabilityPresetInput,
  parseGatewayCapabilityPresetPreviewInput,
  parseProjectGatewayInput,
  parseProjectHostGatewayInput,
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

function withDefaultCommands(openclaw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(openclaw)
  const commands = out.commands
  if (commands === undefined) {
    out.commands = OPENCLAW_DEFAULT_COMMANDS
    return out
  }
  if (isPlainObject(commands)) {
    out.commands = { ...OPENCLAW_DEFAULT_COMMANDS, ...commands }
  }
  return out
}

function buildEffectiveOpenclawConfig(gateway: Record<string, unknown>): Record<string, unknown> {
  const openclaw = isPlainObject(gateway["openclaw"]) ? (gateway["openclaw"] as Record<string, unknown>) : {}
  const out: Record<string, unknown> = withDefaultCommands(openclaw)
  const channels = gateway["channels"]
  const agents = gateway["agents"]
  const hooks = gateway["hooks"]
  const skills = gateway["skills"]
  const plugins = gateway["plugins"]
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
  gatewayId: string
}): void {
  const envVar = params.envVar.trim()
  if (!envVar) return
  const existing = params.secretEnv[envVar]
  if (typeof existing === "string" && existing.trim()) return
  params.secretEnv[envVar] = suggestSecretNameForEnvVar(envVar, params.gatewayId)
}

function ensureGatewayProfileSecretEnv(gateway: Record<string, unknown>): Record<string, unknown> {
  const profile = isPlainObject(gateway.profile) ? (gateway.profile as Record<string, unknown>) : {}
  gateway.profile = profile
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

export const setGatewayOpenclawConfig = createServerFn({ method: "POST" })
  .inputValidator(parseGatewayOpenclawConfigInput)
  .handler(async ({ data }) => {
    const gatewayId = data.gatewayId.trim()
    const hostName = data.host.trim()

    if (!isPlainObject(data.openclaw)) throw new Error("openclaw config must be a JSON object")

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const hostCfg = next?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingGateway = hostCfg?.gateways?.[gatewayId]
    if (!existingGateway || typeof existingGateway !== "object") throw new Error("gateway not found")

    existingGateway.openclaw = data.openclaw

    const schemaMode = data.schemaMode === "live" ? "live" : "pinned"
    let schema: Record<string, unknown> | undefined = undefined
    if (schemaMode === "live") {
      try {
        const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
        const live = await fetchOpenclawSchemaLive({
          projectId: data.projectId,
          host: data.host,
          gatewayId,
        })
        if (!live.ok) {
          return { ok: false as const, issues: [{ code: "schema", path: [], message: live.message }] satisfies ValidationIssue[] }
        }
        schema = live.schema.schema as Record<string, unknown>
      } catch (err) {
        const message = sanitizeLiveSchemaError(err)
        console.error("setGatewayOpenclawConfig live schema failed", message)
        return {
          ok: false as const,
          issues: mapSchemaFailure(message),
        }
      }
    }

    const schemaValidation = validateClawdbotConfig(
      withDefaultCommands(existingGateway.openclaw as Record<string, unknown>),
      schema,
    )
    if (!schemaValidation.ok) {
      return {
        ok: false as const,
        issues: mapSchemaIssues(schemaValidation.issues),
      }
    }

    const securityReport = lintOpenclawSecurityConfig({ openclaw: existingGateway.openclaw, gatewayId })
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
      title: `gateway ${hostName}/${gatewayId} openclaw config`,
      host: hostName,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "gateway.openclaw.write",
      target: { gatewayId },
      data: { runId },
    })

    type SetOpenclawResult = { ok: true; runId: typeof runId } | RunFailure

    return await runWithEventsAndStatus<SetOpenclawResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Updating hosts.${hostName}.gateways.${gatewayId}.openclaw` })
        await writeClawletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })

export const applyGatewayCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseGatewayCapabilityPresetInput)
  .handler(async ({ data }) => {
    const gatewayId = data.gatewayId.trim()
    const hostName = data.host.trim()
    const preset = resolvePreset(data.kind, data.presetId)

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const hostCfg = next?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingGateway = hostCfg?.gateways?.[gatewayId]
    if (!existingGateway || typeof existingGateway !== "object") throw new Error("gateway not found")

    let warnings: string[] = []
    try {
      const result = applyCapabilityPreset({ openclaw: existingGateway.openclaw, channels: existingGateway.channels, preset })
      existingGateway.openclaw = result.openclaw
      existingGateway.channels = result.channels
      warnings = result.warnings
      const secretEnv = ensureGatewayProfileSecretEnv(existingGateway)
      for (const envVar of result.requiredEnv) {
        ensureSecretEnvMapping({ secretEnv, envVar, gatewayId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const effectiveConfig = buildEffectiveOpenclawConfig(existingGateway as Record<string, unknown>)
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
          gatewayId,
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
      title: `gateway ${hostName}/${gatewayId} preset ${preset.id}`,
      host: hostName,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "gateway.preset.apply",
      target: { gatewayId },
      data: { preset: preset.id, runId, warnings },
    })

    type ApplyPresetResult = { ok: true; runId: typeof runId; warnings: string[] } | RunFailure

    return await runWithEventsAndStatus<ApplyPresetResult>({
      client,
      runId,
      redactTokens,
      fn: async (emit) => {
        await emit({ level: "info", message: `Applying ${preset.id} preset for ${gatewayId} (host=${hostName})` })
        for (const w of warnings) await emit({ level: "warn", message: w })
        await writeClawletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId, warnings }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })

export const previewGatewayCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseGatewayCapabilityPresetPreviewInput)
  .handler(async ({ data }) => {
    const gatewayId = data.gatewayId.trim()
    const hostName = data.host.trim()
    const preset = resolvePreset(data.kind, data.presetId)
    const { config: raw } = loadClawletsConfigRaw({
      repoRoot: (await getAdminProjectContext(createConvexClient(), data.projectId)).repoRoot,
    })
    const hostCfg = (raw as any)?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingGateway = (hostCfg as any)?.gateways?.[gatewayId]
    if (!existingGateway || typeof existingGateway !== "object") throw new Error("gateway not found")

    const nextGateway = structuredClone(existingGateway) as Record<string, unknown>
    let warnings: string[] = []
    let requiredEnv: string[] = []
    try {
      const result = applyCapabilityPreset({
        openclaw: (nextGateway as any).openclaw,
        channels: (nextGateway as any).channels,
        preset,
      })
      ;(nextGateway as any).openclaw = result.openclaw
      ;(nextGateway as any).channels = result.channels
      warnings = result.warnings
      requiredEnv = result.requiredEnv
      const secretEnv = ensureGatewayProfileSecretEnv(nextGateway)
      for (const envVar of result.requiredEnv) {
        ensureSecretEnvMapping({ secretEnv, envVar, gatewayId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const schemaValidation = validateClawdbotConfig(buildEffectiveOpenclawConfig(nextGateway))
    const diff = diffConfig(existingGateway, nextGateway, `hosts.${hostName}.gateways.${gatewayId}`)

    return {
      ok: true as const,
      diff: diff as ConfigDiffEntry[],
      warnings,
      requiredEnv,
      issues: schemaValidation.ok ? [] : mapSchemaIssues(schemaValidation.issues),
    }
  })

export const verifyGatewayOpenclawSchema = createServerFn({ method: "POST" })
  .inputValidator(parseProjectHostGatewayInput)
  .handler(async ({ data }) => {
    const gatewayId = data.gatewayId.trim()
    const hostName = data.host.trim()
    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const { config: raw } = loadClawletsConfigRaw({ repoRoot })
    const hostCfg = (raw as any)?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingGateway = (hostCfg as any)?.gateways?.[gatewayId]
    if (!existingGateway || typeof existingGateway !== "object") throw new Error("gateway not found")

    const pinned = getPinnedClawdbotSchema()
    let liveSchema: Record<string, unknown> | null = null
    try {
      const { fetchOpenclawSchemaLive } = await import("~/server/openclaw-schema.server")
      const live = await fetchOpenclawSchemaLive({
        projectId: data.projectId,
        host: hostName,
        gatewayId,
      })
      if (!live.ok) {
        return { ok: false as const, issues: mapSchemaFailure(live.message || LIVE_SCHEMA_ERROR_FALLBACK) }
      }
      liveSchema = live.schema.schema as Record<string, unknown>
      const liveValidation = validateClawdbotConfig(withDefaultCommands((existingGateway as any).openclaw), liveSchema)
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

export const hardenGatewayOpenclawConfig = createServerFn({ method: "POST" })
  .inputValidator(parseProjectGatewayInput)
  .handler(async ({ data }) => {
    const gatewayId = data.gatewayId.trim()
    const hostName = data.host.trim()

    const client = createConvexClient()
    const { repoRoot } = await getAdminProjectContext(client, data.projectId)
    const redactTokens = await readClawletsEnvTokens(repoRoot)
    const { configPath, config: raw } = loadClawletsConfigRaw({ repoRoot })

    const next = structuredClone(raw) as any
    const hostCfg = next?.hosts?.[hostName]
    if (!hostCfg || typeof hostCfg !== "object") throw new Error(`unknown host: ${hostName}`)
    const existingGateway = hostCfg?.gateways?.[gatewayId]
    if (!existingGateway || typeof existingGateway !== "object") throw new Error("gateway not found")

    const hardened = applySecurityDefaults({ openclaw: existingGateway.openclaw, channels: existingGateway.channels })
    if (hardened.changes.length === 0) return { ok: true as const, changes: [], warnings: [] }

    existingGateway.openclaw = hardened.openclaw
    existingGateway.channels = hardened.channels
    const validated = ClawletsConfigSchema.safeParse(next)
    if (!validated.success) return { ok: false as const, issues: mapValidationIssues(validated.error.issues as unknown[]) }

    const { runId } = await client.mutation(api.runs.create, {
      projectId: data.projectId,
      kind: "config_write",
      title: `gateway ${hostName}/${gatewayId} openclaw harden`,
      host: hostName,
    })

    await client.mutation(api.auditLogs.append, {
      projectId: data.projectId,
      action: "gateway.openclaw.harden",
      target: { gatewayId },
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
        await emit({ level: "info", message: `Hardening hosts.${hostName}.gateways.${gatewayId}` })
        for (const w of hardened.warnings) await emit({ level: "warn", message: w })
        await writeClawletsConfig({ configPath, config: validated.data })
        await emit({ level: "info", message: "Done." })
      },
      onSuccess: () => ({ ok: true as const, runId, changes: hardened.changes, warnings: hardened.warnings }),
      onError: (message) => ({ ok: false as const, issues: [{ code: "error", path: [], message }] }),
    })
  })
