type DotOp = {
  path: string
  value?: string
  valueJson?: string
  del: boolean
}

export type OpenclawMemoryBackend = "builtin" | "qmd"

export type BuiltinMemorySettings = {
  enabled: boolean
  sessionMemory: boolean
  maxResults: number
  minScore: number
}

export type QmdMemorySettings = {
  command: string
  sessionsEnabled: boolean
  maxResults: number
}

export type GatewayMemoryState = {
  backend: OpenclawMemoryBackend
  backendConfigured: boolean
  builtin: BuiltinMemorySettings
  qmd: QmdMemorySettings
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.trunc(value))
}

function asClampedScore(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function normalizeBackend(value: unknown): OpenclawMemoryBackend | null {
  const raw = typeof value === "string" ? value.trim() : ""
  return raw === "builtin" || raw === "qmd" ? raw : null
}

function toGatewayPath(host: string, gatewayId: string, ...parts: Array<string | number>): string {
  const suffix = parts.map((part) => String(part)).filter(Boolean).join(".")
  return suffix ? `hosts.${host}.gateways.${gatewayId}.${suffix}` : `hosts.${host}.gateways.${gatewayId}`
}

export function readGatewayMemoryState(params: {
  openclaw: unknown
  agents: unknown
}): GatewayMemoryState {
  const openclaw = asRecord(params.openclaw) ?? {}
  const memory = asRecord(openclaw.memory) ?? {}
  const qmd = asRecord(memory.qmd) ?? {}
  const qmdSessions = asRecord(qmd.sessions) ?? {}
  const qmdLimits = asRecord(qmd.limits) ?? {}
  const backend = normalizeBackend(memory.backend) ?? "builtin"

  const agents = asRecord(params.agents) ?? {}
  const defaults = asRecord(agents.defaults) ?? {}
  const memorySearch = asRecord(defaults.memorySearch) ?? {}
  const experimental = asRecord(memorySearch.experimental) ?? {}
  const query = asRecord(memorySearch.query) ?? {}

  return {
    backend,
    backendConfigured: normalizeBackend(memory.backend) != null,
    builtin: {
      enabled: asBoolean(memorySearch.enabled, true),
      sessionMemory: asBoolean(experimental.sessionMemory, false),
      maxResults: Math.max(1, asNonNegativeInt(query.maxResults, 6) || 6),
      minScore: asClampedScore(query.minScore, 0),
    },
    qmd: {
      command: typeof qmd.command === "string" && qmd.command.trim() ? qmd.command.trim() : "qmd",
      sessionsEnabled: asBoolean(qmdSessions.enabled, false),
      maxResults: Math.max(1, asNonNegativeInt(qmdLimits.maxResults, 6) || 6),
    },
  }
}

export function buildBuiltinMemoryOps(params: {
  host: string
  gatewayId: string
  settings: BuiltinMemorySettings
}): DotOp[] {
  return [
    {
      path: toGatewayPath(params.host, params.gatewayId, "agents", "defaults", "memorySearch", "enabled"),
      valueJson: JSON.stringify(Boolean(params.settings.enabled)),
      del: false,
    },
    {
      path: toGatewayPath(params.host, params.gatewayId, "agents", "defaults", "memorySearch", "experimental", "sessionMemory"),
      valueJson: JSON.stringify(Boolean(params.settings.sessionMemory)),
      del: false,
    },
    {
      path: toGatewayPath(params.host, params.gatewayId, "agents", "defaults", "memorySearch", "query", "maxResults"),
      valueJson: JSON.stringify(Math.max(1, Math.trunc(params.settings.maxResults || 0) || 1)),
      del: false,
    },
    {
      path: toGatewayPath(params.host, params.gatewayId, "agents", "defaults", "memorySearch", "query", "minScore"),
      valueJson: JSON.stringify(Math.max(0, Math.min(1, Number(params.settings.minScore || 0)))),
      del: false,
    },
  ]
}

export function buildOpenclawMemoryConfig(params: {
  openclaw: unknown
  backend: OpenclawMemoryBackend
  qmd: QmdMemorySettings
}): Record<string, unknown> {
  const next = structuredClone(asRecord(params.openclaw) ?? {})
  const memory = asRecord(next.memory) ?? {}
  memory.backend = params.backend
  if (params.backend === "qmd") {
    const qmd = asRecord(memory.qmd) ?? {}
    qmd.command = params.qmd.command.trim() || "qmd"
    qmd.sessions = {
      ...(asRecord(qmd.sessions) ?? {}),
      enabled: Boolean(params.qmd.sessionsEnabled),
    }
    qmd.limits = {
      ...(asRecord(qmd.limits) ?? {}),
      maxResults: Math.max(1, Math.trunc(params.qmd.maxResults || 0) || 1),
    }
    memory.qmd = qmd
  }
  next.memory = memory
  return next
}
