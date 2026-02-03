import { lintOpenclawSecurityConfig } from "@clawlets/core/lib/openclaw-security-lint"
import { createDebouncedIdleRunner, type IdleDebounceHandle } from "~/lib/idle-debounce"

export type ParsedOpenclawConfig =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseOpenclawConfigText(text: string): ParsedOpenclawConfig {
  try {
    const value = JSON.parse(text)
    if (!isPlainObject(value)) {
      return { ok: false, message: "Must be a JSON object (not array/string/number)." }
    }
    return { ok: true, value }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Invalid JSON" }
  }
}

export function createOpenclawParseScheduler(params: {
  getText: () => string
  getBotId: () => string
  onParsed: (parsed: ParsedOpenclawConfig) => void
  onSecurity: (report: ReturnType<typeof lintOpenclawSecurityConfig> | null) => void
  delayMs?: number
  timeoutMs?: number
}): IdleDebounceHandle {
  return createDebouncedIdleRunner({
    delayMs: params.delayMs,
    timeoutMs: params.timeoutMs,
    fn: () => {
      const parsed = parseOpenclawConfigText(params.getText())
      params.onParsed(parsed)
      if (!parsed.ok) {
        params.onSecurity(null)
        return
      }
      const report = lintOpenclawSecurityConfig({ openclaw: parsed.value, gatewayId: params.getBotId() })
      params.onSecurity(report)
    },
  })
}
