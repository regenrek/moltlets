import { createServerFn } from "@tanstack/react-start"
import { applySecurityDefaults } from "@clawlets/core/lib/config/config-patch"
import { applyCapabilityPreset, getChannelCapabilityPreset, type CapabilityPreset } from "@clawlets/core/lib/config/capability-presets"
import { diffConfig, type ConfigDiffEntry } from "@clawlets/core/lib/config/config-diff"
import { validateOpenclawConfig } from "@clawlets/core/lib/openclaw/schema/validate"
import { diffOpenclawChannelSchemasFromArtifacts } from "@clawlets/core/lib/openclaw/schema/diff"
import { getPinnedOpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { OPENCLAW_DEFAULT_COMMANDS } from "@clawlets/core/lib/openclaw/openclaw-defaults"
import { suggestSecretNameForEnvVar } from "@clawlets/core/lib/secrets/env-vars"
import { lintOpenclawSecurityConfig } from "@clawlets/core/lib/openclaw/security-lint"
import { api } from "../../../convex/_generated/api"
import { createConvexClient } from "~/server/convex"
import { fetchOpenclawSchemaLive } from "~/server/openclaw-schema.server"
import {
  parseGatewayOpenclawConfigInput,
  parseGatewayCapabilityPresetInput,
  parseGatewayCapabilityPresetPreviewInput,
  parseProjectGatewayInput,
  parseProjectHostGatewayInput,
  type ValidationIssue,
} from "~/sdk/runtime"
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error"
import { configDotGet, configDotSet } from "~/sdk/config/dot"
import { requireAdminProjectAccess } from "~/sdk/project"

export const LIVE_SCHEMA_ERROR_FALLBACK = "Unable to fetch schema. Check logs."

type RunFailure = { ok: false; issues: ValidationIssue[] }

function gatewayPath(hostName: string, gatewayId: string): string {
  return `hosts.${hostName}.gateways.${gatewayId}`
}

async function loadGatewayConfig(params: {
  projectId: string
  host: string
  gatewayId: string
}): Promise<{ hostName: string; gatewayId: string; gateway: Record<string, unknown> }> {
  const hostName = params.host.trim()
  if (!hostName) throw new Error("missing host")
  const gatewayId = params.gatewayId.trim()
  if (!gatewayId) throw new Error("missing gatewayId")

  const node = await configDotGet({
    data: {
      projectId: params.projectId as any,
      path: gatewayPath(hostName, gatewayId),
    },
  })
  if (!isPlainObject(node.value)) throw new Error("gateway not found")
  return {
    hostName,
    gatewayId,
    gateway: structuredClone(node.value) as Record<string, unknown>,
  }
}

async function writeGatewayConfig(params: {
  projectId: string
  hostName: string
  gatewayId: string
  gateway: Record<string, unknown>
  action: string
  data?: Record<string, unknown>
}): Promise<{ ok: true; runId: string } | RunFailure> {
  const writeRes = await configDotSet({
    data: {
      projectId: params.projectId as any,
      path: gatewayPath(params.hostName, params.gatewayId),
      valueJson: JSON.stringify(params.gateway),
    },
  })

  if (!writeRes.ok) return { ok: false as const, issues: writeRes.issues }

  const client = createConvexClient()
  await client.mutation(api.security.auditLogs.append, {
    projectId: params.projectId as any,
    action: params.action as any,
    target: { gatewayId: params.gatewayId },
    data: {
      runId: writeRes.runId,
      ...(params.data || {}),
    },
  })

  return { ok: true as const, runId: writeRes.runId }
}

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
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    if (!isPlainObject(data.openclaw)) throw new Error("openclaw config must be a JSON object")

    const loaded = await loadGatewayConfig({
      projectId: data.projectId,
      host: data.host,
      gatewayId: data.gatewayId,
    })
    loaded.gateway.openclaw = data.openclaw

    const schemaMode = data.schemaMode === "live" ? "live" : "pinned"
    let schema: Record<string, unknown> | undefined = undefined
    if (schemaMode === "live") {
      try {
        const live = await fetchOpenclawSchemaLive({
          projectId: data.projectId,
          host: loaded.hostName,
          gatewayId: loaded.gatewayId,
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

    const schemaValidation = validateOpenclawConfig(
      withDefaultCommands(loaded.gateway.openclaw as Record<string, unknown>),
      schema,
    )
    if (!schemaValidation.ok) {
      return {
        ok: false as const,
        issues: mapSchemaIssues(schemaValidation.issues),
      }
    }

    const securityReport = lintOpenclawSecurityConfig({ openclaw: loaded.gateway.openclaw, gatewayId: loaded.gatewayId })
    const inlineSecrets = securityReport.findings.filter((finding) => finding.id.startsWith("inlineSecret."))
    if (inlineSecrets.length > 0) {
      return {
        ok: false as const,
        issues: inlineSecrets.slice(0, 20).map((finding) => ({
          code: "security",
          path: finding.id
            .slice("inlineSecret.".length)
            .split(".")
            .filter(Boolean),
          message: finding.detail,
        })),
      }
    }

    return await writeGatewayConfig({
      projectId: data.projectId,
      hostName: loaded.hostName,
      gatewayId: loaded.gatewayId,
      gateway: loaded.gateway,
      action: "gateway.openclaw.write",
    })
  })

export const applyGatewayCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseGatewayCapabilityPresetInput)
  .handler(async ({ data }) => {
    const preset = resolvePreset(data.kind, data.presetId)

    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const loaded = await loadGatewayConfig({
      projectId: data.projectId,
      host: data.host,
      gatewayId: data.gatewayId,
    })

    let warnings: string[] = []
    try {
      const result = applyCapabilityPreset({ openclaw: loaded.gateway.openclaw, channels: loaded.gateway.channels, preset })
      loaded.gateway.openclaw = result.openclaw
      loaded.gateway.channels = result.channels
      warnings = result.warnings
      const secretEnv = ensureGatewayProfileSecretEnv(loaded.gateway)
      for (const envVar of result.requiredEnv) {
        ensureSecretEnvMapping({ secretEnv, envVar, gatewayId: loaded.gatewayId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const effectiveConfig = buildEffectiveOpenclawConfig(loaded.gateway)
    const schemaValidation = validateOpenclawConfig(effectiveConfig)
    if (!schemaValidation.ok) {
      return { ok: false as const, issues: mapSchemaIssues(schemaValidation.issues) }
    }

    if (data.schemaMode === "live") {
      try {
        const live = await fetchOpenclawSchemaLive({
          projectId: data.projectId,
          host: loaded.hostName,
          gatewayId: loaded.gatewayId,
        })
        if (!live.ok) {
          return { ok: false as const, issues: mapSchemaFailure(live.message || LIVE_SCHEMA_ERROR_FALLBACK) }
        }
        const liveValidation = validateOpenclawConfig(effectiveConfig, live.schema.schema as Record<string, unknown>)
        if (!liveValidation.ok) {
          return { ok: false as const, issues: mapSchemaIssues(liveValidation.issues) }
        }
      } catch (err) {
        const message = sanitizeLiveSchemaError(err)
        return { ok: false as const, issues: mapSchemaFailure(message) }
      }
    }

    const writeRes = await writeGatewayConfig({
      projectId: data.projectId,
      hostName: loaded.hostName,
      gatewayId: loaded.gatewayId,
      gateway: loaded.gateway,
      action: "gateway.preset.apply",
      data: { preset: preset.id, warnings },
    })
    if (!writeRes.ok) return writeRes
    return { ok: true as const, runId: writeRes.runId, warnings }
  })

export const previewGatewayCapabilityPreset = createServerFn({ method: "POST" })
  .inputValidator(parseGatewayCapabilityPresetPreviewInput)
  .handler(async ({ data }) => {
    const preset = resolvePreset(data.kind, data.presetId)

    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const loaded = await loadGatewayConfig({
      projectId: data.projectId,
      host: data.host,
      gatewayId: data.gatewayId,
    })

    const existingGateway = loaded.gateway
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
        ensureSecretEnvMapping({ secretEnv, envVar, gatewayId: loaded.gatewayId })
      }
    } catch (err) {
      return { ok: false as const, issues: mapSchemaFailure(String((err as Error)?.message || err)) }
    }

    const schemaValidation = validateOpenclawConfig(buildEffectiveOpenclawConfig(nextGateway))
    const diff = diffConfig(existingGateway, nextGateway, `hosts.${loaded.hostName}.gateways.${loaded.gatewayId}`)

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
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const loaded = await loadGatewayConfig({
      projectId: data.projectId,
      host: data.host,
      gatewayId: data.gatewayId,
    })

    const pinned = getPinnedOpenclawSchemaArtifact()
    try {
      const live = await fetchOpenclawSchemaLive({
        projectId: data.projectId,
        host: loaded.hostName,
        gatewayId: loaded.gatewayId,
      })
      if (!live.ok) {
        return { ok: false as const, issues: mapSchemaFailure(live.message || LIVE_SCHEMA_ERROR_FALLBACK) }
      }
      const liveValidation = validateOpenclawConfig(withDefaultCommands((loaded.gateway as any).openclaw), live.schema.schema as Record<string, unknown>)
      return {
        ok: true as const,
        issues: liveValidation.ok ? [] : mapSchemaIssues(liveValidation.issues),
        schemaDiff: diffOpenclawChannelSchemasFromArtifacts(pinned, live.schema),
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
    const client = createConvexClient()
    await requireAdminProjectAccess(client, data.projectId)

    const loaded = await loadGatewayConfig({
      projectId: data.projectId,
      host: data.host,
      gatewayId: data.gatewayId,
    })

    const hardened = applySecurityDefaults({ openclaw: loaded.gateway.openclaw, channels: loaded.gateway.channels })
    if (hardened.changes.length === 0) return { ok: true as const, changes: [], warnings: [] }

    loaded.gateway.openclaw = hardened.openclaw
    loaded.gateway.channels = hardened.channels

    const schemaValidation = validateOpenclawConfig(buildEffectiveOpenclawConfig(loaded.gateway))
    if (!schemaValidation.ok) {
      return { ok: false as const, issues: mapSchemaIssues(schemaValidation.issues) }
    }

    const writeRes = await writeGatewayConfig({
      projectId: data.projectId,
      hostName: loaded.hostName,
      gatewayId: loaded.gatewayId,
      gateway: loaded.gateway,
      action: "gateway.openclaw.harden",
      data: {
        changesCount: hardened.changes.length,
        warningsCount: hardened.warnings.length,
      },
    })
    if (!writeRes.ok) return writeRes

    return {
      ok: true as const,
      runId: writeRes.runId,
      changes: hardened.changes,
      warnings: hardened.warnings,
    }
  })
