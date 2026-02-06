export const SETUP_STEP_IDS = [
  "host",
  "connection",
  "secrets",
  "creds",
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
  defaultHost?: string | null
  hosts?: Record<string, any>
}

export type SetupModel = {
  selectedHost: string | null
  hasBootstrapped: boolean
  activeStepId: SetupStepId
  steps: SetupStep[]
}

export type DeriveSetupModelInput = {
  config: MinimalConfig | null
  hostFromSearch?: string | null
  stepFromSearch?: string | null
  deployCreds: MinimalDeployCreds | null
  latestBootstrapRun: MinimalRun | null
  latestSecretsVerifyRun: MinimalRun | null
}

export function coerceSetupStepId(value: unknown): SetupStepId | null {
  if (typeof value !== "string") return null
  return (SETUP_STEP_IDS as readonly string[]).includes(value) ? (value as SetupStepId) : null
}

export function deriveSetupModel(input: DeriveSetupModelInput): SetupModel {
  const hosts = input.config?.hosts && typeof input.config.hosts === "object"
    ? Object.keys(input.config.hosts)
    : []
  const hostSet = new Set(hosts)
  const fallbackHost = input.config?.defaultHost && hostSet.has(input.config.defaultHost)
    ? input.config.defaultHost
    : (hosts.sort()[0] ?? null)
  const selectedHost =
    input.hostFromSearch && hostSet.has(input.hostFromSearch)
      ? input.hostFromSearch
      : fallbackHost

  const hostCfg = selectedHost ? (input.config?.hosts as any)?.[selectedHost] : null
  const adminCidrOk = Boolean(String(hostCfg?.provisioning?.adminCidr || "").trim())
  const sshKeysCount = Array.isArray((input.config as any)?.fleet?.sshAuthorizedKeys)
    ? Number(((input.config as any)?.fleet?.sshAuthorizedKeys || []).length)
    : 0
  const hasSshKey = sshKeysCount > 0
  const connectionOk = Boolean(selectedHost && adminCidrOk && hasSshKey)

  const latestSecretsVerifyOk = input.latestSecretsVerifyRun?.status === "succeeded"
  const latestBootstrapOk = input.latestBootstrapRun?.status === "succeeded"

  const credsByKey = new Map((input.deployCreds?.keys || []).map((k) => [k.key, k.status]))
  const hasSopsAgeKey = credsByKey.get("SOPS_AGE_KEY_FILE") === "set"
  const hasHcloudToken = credsByKey.get("HCLOUD_TOKEN") === "set"
  const credsOk = Boolean(hasSopsAgeKey && hasHcloudToken)

  const steps: SetupStep[] = [
    {
      id: "host",
      title: "Choose host",
      status: selectedHost ? "done" : "active",
    },
    {
      id: "connection",
      title: "Connection",
      status: !selectedHost ? "locked" : connectionOk ? "done" : "active",
    },
    {
      id: "secrets",
      title: "Secrets",
      status: !connectionOk ? "locked" : latestSecretsVerifyOk ? "done" : "active",
    },
    {
      id: "creds",
      title: "Deploy credentials",
      status: !latestSecretsVerifyOk ? "locked" : credsOk ? "done" : "active",
    },
    {
      id: "deploy",
      title: "Deploy",
      status: !credsOk ? "locked" : latestBootstrapOk ? "done" : "active",
    },
    {
      id: "verify",
      title: "Verify + hardening",
      optional: true,
      status: !latestBootstrapOk ? "locked" : "pending",
    },
  ]

  const visible = (step: SetupStep) => step.status !== "locked"
  const requested = coerceSetupStepId(input.stepFromSearch)
  const requestedStep = requested && steps.find((s) => s.id === requested && visible(s)) ? requested : null
  const firstIncomplete = steps.find((s) => visible(s) && s.status !== "done")?.id
    ?? steps.find((s) => visible(s))?.id
    ?? "host"

  return {
    selectedHost,
    hasBootstrapped: latestBootstrapOk,
    activeStepId: requestedStep ?? firstIncomplete,
    steps,
  }
}

