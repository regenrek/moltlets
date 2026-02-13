import { WEB_SETUP_REQUIRED_KEYS } from "../deploy-creds-ui"

export const SETUP_STEP_IDS = [
  "infrastructure",
  "connection",
  "creds",
  "secrets",
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
  latestBootstrapRun: MinimalRun | null
  latestBootstrapSecretsVerifyRun: MinimalRun | null
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
  const draftDeployCredsSet = input.setupDraft?.sealedSecretDrafts?.deployCreds?.status === "set"
  const draftBootstrapSecretsSet = input.setupDraft?.sealedSecretDrafts?.bootstrapSecrets?.status === "set"

  const infrastructureHostOkLive = resolveInfrastructureHostOk({ hostCfg: asRecord(hostCfg) })
  const infrastructureHostOkDraft = Boolean(
    asTrimmedString(draftInfrastructure?.serverType).length > 0
      && asTrimmedString(draftInfrastructure?.location).length > 0,
  )
  const infrastructureHostOk = infrastructureHostOkLive || infrastructureHostOkDraft
  const provisioning = asRecord(hostCfg?.provisioning) ?? {}
  const adminCidrOkLive = Boolean(asTrimmedString(provisioning.adminCidr))
  const adminCidrOkDraft = Boolean(asTrimmedString(draftConnection?.adminCidr))
  const adminCidrOk = adminCidrOkLive || adminCidrOkDraft
  const sshAuthorizedKeys = Array.isArray(input.config?.fleet?.sshAuthorizedKeys)
    ? input.config?.fleet?.sshAuthorizedKeys ?? []
    : []
  const hasSshKeyLive = sshAuthorizedKeys.length > 0
  const hasSshKeyDraft = Boolean(
    Number(draftConnection?.sshKeyCount || 0) > 0
      || (Array.isArray(draftConnection?.sshAuthorizedKeys) && draftConnection.sshAuthorizedKeys.length > 0),
  )
  const hasSshKey = hasSshKeyLive || hasSshKeyDraft
  const connectionOk = Boolean(selectedHost && adminCidrOk && hasSshKey)

  const latestSecretsVerifyOk = input.latestBootstrapSecretsVerifyRun?.status === "succeeded"
  const latestBootstrapOk = input.latestBootstrapRun?.status === "succeeded"
  const secretsOk = latestSecretsVerifyOk || draftBootstrapSecretsSet

  const credsByKey = new Map((input.deployCreds?.keys || []).map((entry) => [entry.key, entry.status]))
  const hcloudOk = credsByKey.get("HCLOUD_TOKEN") === "set" || draftDeployCredsSet
  const githubOk = credsByKey.get("GITHUB_TOKEN") === "set" || draftDeployCredsSet
  const sopsOk = credsByKey.get("SOPS_AGE_KEY_FILE") === "set" || draftDeployCredsSet
  const credsOk = resolveSetupCredsOk({ credsByKey }) || draftDeployCredsSet
  const providerCredsOk = (githubOk && sopsOk) || draftDeployCredsSet
  const infrastructureOk = Boolean(selectedHost) && infrastructureHostOk && hcloudOk

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
      id: "creds",
      title: "Provider Tokens",
      status: !connectionOk ? "locked" : providerCredsOk ? "done" : "active",
    },
    {
      id: "secrets",
      title: "Server Passwords",
      status: !credsOk ? "locked" : secretsOk ? "done" : "active",
    },
    {
      id: "deploy",
      title: "Install Server",
      status: !secretsOk ? "locked" : latestBootstrapOk ? "done" : "active",
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
