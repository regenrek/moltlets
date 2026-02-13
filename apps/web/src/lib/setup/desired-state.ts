export type FieldSource = "pending" | "draft" | "config" | "missing"

type MinimalSetupConfig = {
  hosts?: Record<string, Record<string, unknown>>
  fleet?: {
    sshAuthorizedKeys?: unknown
  }
}

type MinimalSetupDraft = {
  nonSecretDraft?: {
    infrastructure?: Record<string, unknown> | null
    connection?: Record<string, unknown> | null
  } | null
}

type PendingNonSecretDraft = {
  infrastructure?: Record<string, unknown> | null
  connection?: Record<string, unknown> | null
}

export type EffectiveSetupInfrastructure = {
  serverType: string
  image: string
  location: string
  allowTailscaleUdpIngress: boolean
  source: {
    serverType: FieldSource
    image: FieldSource
    location: FieldSource
    allowTailscaleUdpIngress: FieldSource
  }
}

export type EffectiveSetupConnection = {
  adminCidr: string
  sshExposureMode: "bootstrap" | "tailnet" | "public"
  sshAuthorizedKeys: string[]
  sshKeyCount: number
  source: {
    adminCidr: FieldSource
    sshExposureMode: FieldSource
    sshAuthorizedKeys: FieldSource
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim()
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

export function toUniqueStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(
    new Set(
      values
        .map((row) => asString(row))
        .filter(Boolean),
    ),
  )
}

function coerceSshExposureMode(value: string): "bootstrap" | "tailnet" | "public" | null {
  if (value === "bootstrap" || value === "tailnet" || value === "public") return value
  return null
}

function selectString(
  values: Array<{ source: Exclude<FieldSource, "missing">; value: unknown }>,
): { value: string; source: FieldSource } {
  for (const candidate of values) {
    const normalized = asString(candidate.value)
    if (!normalized) continue
    return { value: normalized, source: candidate.source }
  }
  return { value: "", source: "missing" }
}

function selectBoolean(
  values: Array<{ source: Exclude<FieldSource, "missing">; value: unknown }>,
  fallback: boolean,
): { value: boolean; source: FieldSource } {
  for (const candidate of values) {
    const normalized = asBoolean(candidate.value)
    if (normalized === null) continue
    return { value: normalized, source: candidate.source }
  }
  return { value: fallback, source: "missing" }
}

function selectSshExposureMode(
  values: Array<{ source: Exclude<FieldSource, "missing">; value: unknown }>,
): { value: "bootstrap" | "tailnet" | "public"; source: FieldSource } {
  for (const candidate of values) {
    const normalized = coerceSshExposureMode(asString(candidate.value))
    if (!normalized) continue
    return { value: normalized, source: candidate.source }
  }
  return { value: "bootstrap", source: "missing" }
}

export function deriveEffectiveSetupDesiredState(params: {
  config: MinimalSetupConfig | null
  host: string
  setupDraft: MinimalSetupDraft | null
  pendingNonSecretDraft: PendingNonSecretDraft | null
}): {
  infrastructure: EffectiveSetupInfrastructure
  connection: EffectiveSetupConnection
} {
  const host = asString(params.host)
  const hostCfg = host ? asRecord(params.config?.hosts?.[host]) ?? {} : {}
  const provisioning = asRecord(hostCfg.provisioning) ?? {}
  const sshExposure = asRecord(hostCfg.sshExposure) ?? {}
  const hetzner = asRecord(hostCfg.hetzner) ?? {}
  const fleet = asRecord(params.config?.fleet) ?? {}
  const draftInfrastructure = asRecord(params.setupDraft?.nonSecretDraft?.infrastructure) ?? {}
  const draftConnection = asRecord(params.setupDraft?.nonSecretDraft?.connection) ?? {}
  const pendingInfrastructure = asRecord(params.pendingNonSecretDraft?.infrastructure) ?? {}
  const pendingConnection = asRecord(params.pendingNonSecretDraft?.connection) ?? {}

  const serverType = selectString([
    { source: "pending", value: pendingInfrastructure.serverType },
    { source: "draft", value: draftInfrastructure.serverType },
    { source: "config", value: hetzner.serverType },
  ])
  const image = selectString([
    { source: "pending", value: pendingInfrastructure.image },
    { source: "draft", value: draftInfrastructure.image },
    { source: "config", value: hetzner.image },
  ])
  const location = selectString([
    { source: "pending", value: pendingInfrastructure.location },
    { source: "draft", value: draftInfrastructure.location },
    { source: "config", value: hetzner.location },
  ])
  const allowTailscaleUdpIngress = selectBoolean([
    { source: "pending", value: pendingInfrastructure.allowTailscaleUdpIngress },
    { source: "draft", value: draftInfrastructure.allowTailscaleUdpIngress },
    { source: "config", value: hetzner.allowTailscaleUdpIngress },
  ], true)

  const adminCidr = selectString([
    { source: "pending", value: pendingConnection.adminCidr },
    { source: "draft", value: draftConnection.adminCidr },
    { source: "config", value: provisioning.adminCidr },
  ])
  const sshExposureMode = selectSshExposureMode([
    { source: "pending", value: pendingConnection.sshExposureMode },
    { source: "draft", value: draftConnection.sshExposureMode },
    { source: "config", value: sshExposure.mode },
  ])

  const keysFromPending = toUniqueStringArray(pendingConnection.sshAuthorizedKeys)
  const keysFromDraft = toUniqueStringArray(draftConnection.sshAuthorizedKeys)
  const keysFromConfig = toUniqueStringArray(fleet.sshAuthorizedKeys)
  const sshAuthorizedKeys =
    keysFromPending.length > 0
      ? keysFromPending
      : keysFromDraft.length > 0
        ? keysFromDraft
        : keysFromConfig
  const sshAuthorizedKeysSource: FieldSource =
    keysFromPending.length > 0
      ? "pending"
      : keysFromDraft.length > 0
        ? "draft"
        : keysFromConfig.length > 0
          ? "config"
          : "missing"

  // Keep count and value list in strict sync to avoid setup readiness drift.
  const sshKeyCount = sshAuthorizedKeys.length

  return {
    infrastructure: {
      serverType: serverType.value,
      image: image.value,
      location: location.value,
      allowTailscaleUdpIngress: allowTailscaleUdpIngress.value,
      source: {
        serverType: serverType.source,
        image: image.source,
        location: location.source,
        allowTailscaleUdpIngress: allowTailscaleUdpIngress.source,
      },
    },
    connection: {
      adminCidr: adminCidr.value,
      sshExposureMode: sshExposureMode.value,
      sshAuthorizedKeys,
      sshKeyCount,
      source: {
        adminCidr: adminCidr.source,
        sshExposureMode: sshExposureMode.source,
        sshAuthorizedKeys: sshAuthorizedKeysSource,
      },
    },
  }
}
