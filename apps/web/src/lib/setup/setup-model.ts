export const SETUP_STEP_IDS = [
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

function resolveProviderCredsOk(params: {
  provider: string
  credsByKey: Map<string, "set" | "unset">
}): boolean {
  if (params.provider === "aws") {
    const hasAccessKey = params.credsByKey.get("AWS_ACCESS_KEY_ID") === "set"
    const hasSecretKey = params.credsByKey.get("AWS_SECRET_ACCESS_KEY") === "set"
    return hasAccessKey && hasSecretKey
  }
  return params.credsByKey.get("HCLOUD_TOKEN") === "set"
}

export function deriveSetupModel(input: DeriveSetupModelInput): SetupModel {
  const hosts = input.config?.hosts && typeof input.config.hosts === "object"
    ? Object.keys(input.config.hosts)
    : []
  const hostSet = new Set(hosts)
  const selectedHost =
    input.hostFromRoute && hostSet.has(input.hostFromRoute)
      ? input.hostFromRoute
      : null

  const hostCfg = selectedHost ? input.config?.hosts?.[selectedHost] ?? null : null
  const provisioning = asRecord(hostCfg?.provisioning) ?? {}
  const provider = asTrimmedString(provisioning.provider) || "hetzner"
  const adminCidrOk = Boolean(asTrimmedString(provisioning.adminCidr))
  const sshAuthorizedKeys = Array.isArray(input.config?.fleet?.sshAuthorizedKeys)
    ? input.config?.fleet?.sshAuthorizedKeys ?? []
    : []
  const hasSshKey = sshAuthorizedKeys.length > 0
  const connectionOk = Boolean(selectedHost && adminCidrOk && hasSshKey)

  const latestSecretsVerifyOk = input.latestBootstrapSecretsVerifyRun?.status === "succeeded"
  const latestBootstrapOk = input.latestBootstrapRun?.status === "succeeded"

  const credsByKey = new Map((input.deployCreds?.keys || []).map((entry) => [entry.key, entry.status]))
  const hasSopsAgeKey = credsByKey.get("SOPS_AGE_KEY_FILE") === "set"
  const providerCredsOk = resolveProviderCredsOk({ provider, credsByKey })
  const credsOk = Boolean(hasSopsAgeKey && providerCredsOk)

  const steps: SetupStep[] = [
    {
      id: "connection",
      title: "Server Access",
      status: !selectedHost ? "locked" : connectionOk ? "done" : "active",
    },
    {
      id: "creds",
      title: "Provider Tokens",
      status: !connectionOk ? "locked" : credsOk ? "done" : "active",
    },
    {
      id: "secrets",
      title: "Server Passwords",
      status: !credsOk ? "locked" : latestSecretsVerifyOk ? "done" : "active",
    },
    {
      id: "deploy",
      title: "Install Server",
      status: !latestSecretsVerifyOk ? "locked" : latestBootstrapOk ? "done" : "active",
    },
    {
      id: "verify",
      title: "Secure and Verify",
      optional: true,
      status: !latestBootstrapOk ? "locked" : "pending",
    },
  ]

  const visible = (step: SetupStep) => step.status !== "locked"
  const requested = coerceSetupStepId(input.stepFromSearch)
  const requestedStep = requested && steps.find((step) => step.id === requested && visible(step)) ? requested : null
  const firstIncomplete = steps.find((step) => visible(step) && step.status !== "done")?.id
    ?? steps.find((step) => visible(step))?.id
    ?? "connection"
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
