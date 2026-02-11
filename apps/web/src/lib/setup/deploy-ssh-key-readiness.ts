export type DeploySshKeySource = "fleet" | "missing"

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

export function deriveDeploySshKeyReadiness(params: {
  fleetSshAuthorizedKeys: unknown
}): { ready: boolean; source: DeploySshKeySource } {
  const fleetKeys = Array.isArray(params.fleetSshAuthorizedKeys)
    ? params.fleetSshAuthorizedKeys
    : []
  const hasFleetKey = fleetKeys.some((key) => hasNonEmptyString(key))
  if (hasFleetKey) return { ready: true, source: "fleet" }
  return { ready: false, source: "missing" }
}
