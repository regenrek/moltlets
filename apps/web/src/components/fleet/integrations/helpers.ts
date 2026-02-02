import { listPinnedChannelUiModels } from "@clawlets/core/lib/channel-ui-metadata"

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseTextList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function getEnvMapping(params: {
  envVar: string
  fleetSecretEnv: unknown
  botSecretEnv: unknown
}): { secretName: string; scope: "bot" | "fleet" } | null {
  const envVar = params.envVar
  if (isPlainObject(params.botSecretEnv)) {
    const v = params.botSecretEnv[envVar]
    if (typeof v === "string" && v.trim()) return { secretName: v.trim(), scope: "bot" }
  }
  if (isPlainObject(params.fleetSecretEnv)) {
    const v = params.fleetSecretEnv[envVar]
    if (typeof v === "string" && v.trim()) return { secretName: v.trim(), scope: "fleet" }
  }
  return null
}

function readPath(root: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }
  return current
}

export function readInlineSecretWarnings(clawdbot: unknown): string[] {
  const warnings: string[] = []
  const cfg = isPlainObject(clawdbot) ? (clawdbot as Record<string, unknown>) : {}

  for (const channel of listPinnedChannelUiModels()) {
    for (const tokenField of channel.tokenFields) {
      const value = readPath(cfg, tokenField.path)
      if (typeof value !== "string" || !value.trim() || value.includes("${")) continue
      const fieldLabel = tokenField.path.split(".").pop() || "token"
      warnings.push(
        `${channel.name} ${fieldLabel} looks inline (avoid secrets in config; use \${${tokenField.envVar}}).`,
      )
    }
  }

  const hooks = cfg["hooks"]
  if (isPlainObject(hooks)) {
    const hooksToken = hooks["token"]
    if (typeof hooksToken === "string" && hooksToken.trim() && !hooksToken.includes("${")) {
      warnings.push("Hooks token looks inline (avoid secrets in config; use ${OPENCLAW_HOOKS_TOKEN}).")
    }
    const gmail = hooks["gmail"]
    const gmailPushToken = isPlainObject(gmail) ? gmail["pushToken"] : undefined
    if (typeof gmailPushToken === "string" && gmailPushToken.trim() && !gmailPushToken.includes("${")) {
      warnings.push("Hooks Gmail pushToken looks inline (avoid secrets in config; use ${OPENCLAW_HOOKS_GMAIL_PUSH_TOKEN}).")
    }
  }

  const skills = cfg["skills"]
  const entries = isPlainObject(skills) ? skills["entries"] : undefined
  if (isPlainObject(entries)) {
    for (const [skill, entry] of Object.entries(entries)) {
      if (!isPlainObject(entry)) continue
      const apiKey = entry["apiKey"]
      const apiKeySecret = entry["apiKeySecret"]
      const hasSecret = typeof apiKeySecret === "string" && Boolean(apiKeySecret.trim())
      if (typeof apiKey === "string" && apiKey.trim() && !apiKey.includes("${") && !hasSecret) {
        warnings.push(`Skill ${skill} apiKey looks inline (avoid secrets in config; use apiKeySecret).`)
      }
    }
  }

  return warnings
}

export function listEnabledChannels(clawdbot: unknown): string[] {
  const cfg = isPlainObject(clawdbot) ? (clawdbot as Record<string, unknown>) : {}
  const channels = cfg["channels"]
  if (!isPlainObject(channels)) return []
  return Object.keys(channels)
    .filter((k) => {
      const entry = channels[k]
      if (!isPlainObject(entry)) return true
      return entry["enabled"] !== false
    })
    .sort()
}
