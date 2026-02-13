import { WEB_SETUP_REQUIRED_KEYS } from "../deploy-creds-ui"

export const SETUP_STEP_IDS = [
  "infrastructure",
  "connection",
  "tailscale-lockdown",
  "predeploy",
  "deploy",
  "verify",
] as const

export type SetupStepId = (typeof SETUP_STEP_IDS)[number]

export type SetupStepStatus = "done" | "active" | "pending" | "locked"

export type SetupStep = {
  id: SetupStepId
  title: string
  status: SetupStepStatus
  optional?: boolean
  blockedReason?: string
}

type MinimalRun = {
  status?: string | null
}

type MinimalDeployCreds = {
  keys?: Array<{ key: string; status: "set" | "unset" }>
}

type MinimalConfig = {
  hosts?: Record<string, Record<string, unknown>>
  fleet?: {
    sshAuthorizedKeys?: unknown[]
  }
}

type MinimalSetupDraft = {
  nonSecretDraft?: {
    infrastructure?: {
      serverType?: string
      image?: string
      location?: string
      allowTailscaleUdpIngress?: boolean
      volumeEnabled?: boolean
      volumeSizeGb?: number
    }
    connection?: {
      adminCidr?: string
      sshExposureMode?: "bootstrap" | "tailnet" | "public"
      sshKeyCount?: number
      sshAuthorizedKeys?: string[]
    }
  }
  sealedSecretDrafts?: {
    deployCreds?: { status?: "set" | "missing" }
    bootstrapSecrets?: { status?: "set" | "missing" }
  }
}

type MinimalPendingNonSecretDraft = {
  infrastructure?: {
    serverType?: string
    image?: string
    location?: string
    allowTailscaleUdpIngress?: boolean
  }
  connection?: {
    adminCidr?: string
    sshExposureMode?: "bootstrap" | "tailnet" | "public"
    sshKeyCount?: number
    sshAuthorizedKeys?: string[]
  }
}

export type SetupModel = {
  selectedHost: string | null
  hasBootstrapped: boolean
  activeStepId: SetupStepId
  steps: SetupStep[]
  showCelebration: boolean
}

export type DeriveSetupModelInput = {
  config: MinimalConfig | null
  hostFromRoute: string | null
  stepFromSearch?: string | null
  deployCreds: MinimalDeployCreds | null
  setupDraft?: MinimalSetupDraft | null
  pendingNonSecretDraft?: MinimalPendingNonSecretDraft | null
  latestBootstrapRun: MinimalRun | null
  latestBootstrapSecretsVerifyRun: MinimalRun | null
  useTailscaleLockdown?: boolean
  pendingTailscaleAuthKey?: string
  hasTailscaleAuthKey?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).trim()
  }
  return ""
}

export function coerceSetupStepId(value: unknown): SetupStepId | null {
  if (typeof value !== "string") return null
  return (SETUP_STEP_IDS as readonly string[]).includes(value) ? (value as SetupStepId) : null
}

function resolveSetupCredsOk(params: {
  credsByKey: Map<string, "set" | "unset">
}): boolean {
  return WEB_SETUP_REQUIRED_KEYS.every((key) => params.credsByKey.get(key) === "set")
}

function resolveInfrastructureHostOk(params: {
  hostCfg: Record<string, unknown> | null
}): boolean {
  if (!params.hostCfg) return false
  const provisioning = asRecord(params.hostCfg.provisioning) ?? {}
  if (asTrimmedString(provisioning.provider) !== "hetzner") return false
  const hetzner = asRecord(params.hostCfg.hetzner) ?? {}
  const serverType = asTrimmedString(hetzner.serverType)
  const location = asTrimmedString(hetzner.location)
  return serverType.length > 0 && location.length > 0
}

export function deriveSetupModel(input: DeriveSetupModelInput): SetupModel {
  const selectedHost = asTrimmedString(input.hostFromRoute) || null

  const hostCfg = selectedHost ? input.config?.hosts?.[selectedHost] ?? null : null
  const draftInfrastructure = input.setupDraft?.nonSecretDraft?.infrastructure ?? null
  const draftConnection = input.setupDraft?.nonSecretDraft?.connection ?? null
  const pendingInfrastructure = input.pendingNonSecretDraft?.infrastructure ?? null
  const pendingConnection = input.pendingNonSecretDraft?.connection ?? null
  const draftDeployCredsSet = input.setupDraft?.sealedSecretDrafts?.deployCreds?.status === "set"

  const infrastructureHostOkLive = resolveInfrastructureHostOk({ hostCfg: asRecord(hostCfg) })
  const infrastructureHostOkDraft = Boolean(
    asTrimmedString(draftInfrastructure?.serverType).length > 0
      && asTrimmedString(draftInfrastructure?.location).length > 0,
  )
  const infrastructureHostOkPending = Boolean(
    asTrimmedString(pendingInfrastructure?.serverType).length > 0
      && asTrimmedString(pendingInfrastructure?.location).length > 0,
  )
  const infrastructureHostOk = infrastructureHostOkLive || infrastructureHostOkDraft || infrastructureHostOkPending

  const provisioning = asRecord(hostCfg?.provisioning) ?? {}
  const adminCidrOkLive = Boolean(asTrimmedString(provisioning.adminCidr))
  const adminCidrOkDraft = Boolean(asTrimmedString(draftConnection?.adminCidr))
  const adminCidrOkPending = Boolean(asTrimmedString(pendingConnection?.adminCidr))
  const adminCidrOk = adminCidrOkLive || adminCidrOkDraft || adminCidrOkPending

  const sshAuthorizedKeys = Array.isArray(input.config?.fleet?.sshAuthorizedKeys)
    ? input.config?.fleet?.sshAuthorizedKeys ?? []
    : []
  const hasSshKeyLive = sshAuthorizedKeys.length > 0
  const hasSshKeyDraft = Boolean(
    Number(draftConnection?.sshKeyCount || 0) > 0
      || (Array.isArray(draftConnection?.sshAuthorizedKeys) && draftConnection.sshAuthorizedKeys.length > 0),
  )
  const hasSshKeyPending = Boolean(
    Number(pendingConnection?.sshKeyCount || 0) > 0
      || (Array.isArray(pendingConnection?.sshAuthorizedKeys) && pendingConnection.sshAuthorizedKeys.length > 0),
  )
  const hasSshKey = hasSshKeyLive || hasSshKeyDraft || hasSshKeyPending
  const connectionOk = Boolean(selectedHost && adminCidrOk && hasSshKey)

  const latestBootstrapOk = input.latestBootstrapRun?.status === "succeeded"

  const credsByKey = new Map((input.deployCreds?.keys || []).map((entry) => [entry.key, entry.status]))
  const hcloudOk = credsByKey.get("HCLOUD_TOKEN") === "set" || draftDeployCredsSet
  const githubOk = credsByKey.get("GITHUB_TOKEN") === "set" || draftDeployCredsSet
  const sopsOk = credsByKey.get("SOPS_AGE_KEY_FILE") === "set" || draftDeployCredsSet
  const providerCredsOk = resolveSetupCredsOk({
    credsByKey: new Map([
      ["HCLOUD_TOKEN", hcloudOk ? "set" : "unset"],
      ["GITHUB_TOKEN", githubOk ? "set" : "unset"],
      ["SOPS_AGE_KEY_FILE", sopsOk ? "set" : "unset"],
    ]),
  }) || ((githubOk && sopsOk) || draftDeployCredsSet)
  const infrastructureOk = Boolean(selectedHost) && infrastructureHostOk && hcloudOk
  const useTailscaleLockdown = input.useTailscaleLockdown === true
  const hasTailscaleAuthKey = Boolean(input.hasTailscaleAuthKey)
  const hasPendingTailscaleAuthKey = asTrimmedString(input.pendingTailscaleAuthKey).length > 0
  const tailscaleLockdownOk = !useTailscaleLockdown || hasTailscaleAuthKey || hasPendingTailscaleAuthKey

  const steps: SetupStep[] = [
    {
      id: "infrastructure",
      title: "Hetzner setup",
      status: infrastructureOk ? "done" : "active",
    },
    {
      id: "connection",
      title: "Server Access",
      status: !infrastructureOk ? "locked" : connectionOk ? "done" : "active",
    },
    {
      id: "tailscale-lockdown",
      title: "Tailscale lockdown",
      optional: true,
      status: !connectionOk ? "locked" : tailscaleLockdownOk ? "done" : "active",
    },
    {
      id: "predeploy",
      title: "Pre-deploy",
      status: !connectionOk ? "locked" : providerCredsOk ? "done" : "active",
    },
    {
      id: "deploy",
      title: "Install server",
      status: !providerCredsOk ? "locked" : latestBootstrapOk ? "done" : "active",
    },
    {
      id: "verify",
      title: "Secure and Verify",
      optional: true,
      status: !latestBootstrapOk ? "locked" : "pending",
    },
  ]

  const requested = coerceSetupStepId(input.stepFromSearch)
  const requestedStep = requested && steps.find((step) => step.id === requested) ? requested : null
  const firstIncomplete = steps.find((step) => step.status !== "done")?.id
    ?? steps[0]?.id
    ?? "infrastructure"
  const requiredSteps = steps.filter((step) => !step.optional)
  const showCelebration = requiredSteps.every((step) => step.status === "done")

  return {
    selectedHost,
    hasBootstrapped: latestBootstrapOk,
    activeStepId: requestedStep ?? firstIncomplete,
    steps,
    showCelebration,
  }
}

export function deriveHostSetupStepper(input: {
  steps: SetupStep[]
  activeStepId: SetupStepId
}): { steps: SetupStep[]; activeStepId: SetupStepId } {
  const steps = input.steps
  const allowed = new Set(steps.map((step) => step.id))
  const activeStepId = allowed.has(input.activeStepId)
    ? input.activeStepId
    : steps.find((step) => step.status !== "done")?.id
      ?? steps[0]?.id
      ?? input.activeStepId

  return { steps, activeStepId }
}
