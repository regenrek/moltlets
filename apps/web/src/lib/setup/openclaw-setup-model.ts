export const OPENCLAW_SETUP_STEP_IDS = [
  "enable",
  "gateway",
  "secrets",
  "deploy",
] as const

export type OpenClawSetupStepId = (typeof OPENCLAW_SETUP_STEP_IDS)[number]
export type OpenClawSetupStepStatus = "done" | "active" | "pending" | "locked"

export type OpenClawSetupStep = {
  id: OpenClawSetupStepId
  title: string
  status: OpenClawSetupStepStatus
}

type MinimalRun = {
  status?: string | null
}

type MinimalConfig = {
  hosts?: Record<string, Record<string, unknown>>
}

export type OpenClawSetupModel = {
  selectedHost: string | null
  activeStepId: OpenClawSetupStepId
  steps: OpenClawSetupStep[]
  showCelebration: boolean
}

export type DeriveOpenClawSetupModelInput = {
  config: MinimalConfig | null
  hostFromRoute: string | null
  stepFromSearch?: string | null
  latestOpenClawSecretsVerifyRun: MinimalRun | null
  latestUpdateApplyRun: MinimalRun | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function coerceOpenClawSetupStepId(value: unknown): OpenClawSetupStepId | null {
  if (typeof value !== "string") return null
  return (OPENCLAW_SETUP_STEP_IDS as readonly string[]).includes(value)
    ? (value as OpenClawSetupStepId)
    : null
}

export function deriveOpenClawSetupModel(input: DeriveOpenClawSetupModelInput): OpenClawSetupModel {
  const hosts = input.config?.hosts && typeof input.config.hosts === "object"
    ? Object.keys(input.config.hosts)
    : []
  const hostSet = new Set(hosts)
  const selectedHost =
    input.hostFromRoute && hostSet.has(input.hostFromRoute)
      ? input.hostFromRoute
      : null

  const hostCfg = selectedHost ? input.config?.hosts?.[selectedHost] ?? null : null
  const openclawCfg = asRecord(hostCfg?.openclaw) ?? {}
  const enabled = Boolean(openclawCfg.enable)
  const gatewaysOrder = Array.isArray(hostCfg?.gatewaysOrder)
    ? hostCfg.gatewaysOrder.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
  const gatewayMap = asRecord(hostCfg?.gateways) ?? {}
  const hasGateway = gatewaysOrder.length > 0 || Object.keys(gatewayMap).length > 0
  const secretsOk = input.latestOpenClawSecretsVerifyRun?.status === "succeeded"
  const deployOk = input.latestUpdateApplyRun?.status === "succeeded"

  const steps: OpenClawSetupStep[] = [
    {
      id: "enable",
      title: "Enable OpenClaw",
      status: !selectedHost ? "locked" : enabled ? "done" : "active",
    },
    {
      id: "gateway",
      title: "Configure Gateway",
      status: !enabled ? "locked" : hasGateway ? "done" : "active",
    },
    {
      id: "secrets",
      title: "App Secrets",
      status: !hasGateway ? "locked" : secretsOk ? "done" : "active",
    },
    {
      id: "deploy",
      title: "Deploy Update",
      status: !secretsOk ? "locked" : deployOk ? "done" : "active",
    },
  ]

  const visible = (step: OpenClawSetupStep) => step.status !== "locked"
  const requested = coerceOpenClawSetupStepId(input.stepFromSearch)
  const requestedStep = requested && steps.find((step) => step.id === requested && visible(step)) ? requested : null
  const firstIncomplete = steps.find((step) => visible(step) && step.status !== "done")?.id
    ?? steps.find((step) => visible(step))?.id
    ?? "enable"
  const showCelebration = steps.every((step) => step.status === "done")

  return {
    selectedHost,
    activeStepId: requestedStep ?? firstIncomplete,
    steps,
    showCelebration,
  }
}
