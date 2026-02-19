import { deriveEffectiveSetupDesiredState } from "~/lib/setup/desired-state"

export const SETUP_STEP_IDS = [
  "infrastructure",
  "connection",
  "tailscale-lockdown",
  "creds",
  "deploy",
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
    hostBootstrapCreds?: { status?: "set" | "missing" }
    hostBootstrapSecrets?: { status?: "set" | "missing" }
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
  setupDraft?: MinimalSetupDraft | null
  pendingNonSecretDraft?: MinimalPendingNonSecretDraft | null
  latestBootstrapRun: MinimalRun | null
  latestBootstrapSecretsVerifyRun: MinimalRun | null
  infraExists?: boolean
  useTailscaleLockdown?: boolean
  hasHostTailscaleAuthKey?: boolean
  hasActiveHcloudToken?: boolean
  hasProjectGithubToken?: boolean
  hasProjectGitRemoteOrigin?: boolean
  hasProjectGithubTokenAccess?: boolean
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

export function deriveSetupModel(input: DeriveSetupModelInput): SetupModel {
  const selectedHost = asTrimmedString(input.hostFromRoute) || null

  const desired = deriveEffectiveSetupDesiredState({
    config: input.config,
    host: selectedHost ?? "",
    setupDraft: input.setupDraft ?? null,
    pendingNonSecretDraft: input.pendingNonSecretDraft ?? null,
  })

  const infrastructureHostOk = Boolean(
    asTrimmedString(desired.infrastructure.serverType).length > 0
      && asTrimmedString(desired.infrastructure.location).length > 0,
  )
  const adminCidrOk = asTrimmedString(desired.connection.adminCidr).length > 0
  const hasSshKey = desired.connection.sshAuthorizedKeys.length > 0
  const connectionOk = Boolean(selectedHost && adminCidrOk && hasSshKey)

  const latestBootstrapOk = input.latestBootstrapRun?.status === "succeeded"
  const infraMissing = input.infraExists === false
  const bootstrappedOk = latestBootstrapOk && !infraMissing

  const hcloudOk = Boolean(input.hasActiveHcloudToken)
  const githubCredsOk = Boolean(input.hasProjectGithubToken)
  const gitRemoteOriginOk = Boolean(input.hasProjectGitRemoteOrigin)
  const infrastructureProvisioningOk = Boolean(selectedHost) && infrastructureHostOk && hcloudOk
  const infrastructureStepDone = infrastructureProvisioningOk
  const credsStepDone = githubCredsOk && gitRemoteOriginOk
  const connectionStepDone = connectionOk
  const useTailscaleLockdown = input.useTailscaleLockdown === true
  const hasTailscaleAuthKey = Boolean(input.hasHostTailscaleAuthKey)
  const tailscaleLockdownOk = !useTailscaleLockdown || hasTailscaleAuthKey

  const steps: SetupStep[] = [
    {
      id: "infrastructure",
      title: "Hetzner setup",
      status: infrastructureStepDone ? "done" : "active",
    },
    {
      id: "connection",
      title: "Server Access",
      status: connectionStepDone ? "done" : "active",
    },
    {
      id: "tailscale-lockdown",
      title: "Tailscale lockdown",
      optional: true,
      status: tailscaleLockdownOk ? "done" : "active",
    },
    {
      id: "creds",
      title: "Git Configuration",
      status: credsStepDone ? "done" : "active",
    },
    {
      id: "deploy",
      title: "Install server",
      status: bootstrappedOk ? "done" : "active",
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
    hasBootstrapped: bootstrappedOk,
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
