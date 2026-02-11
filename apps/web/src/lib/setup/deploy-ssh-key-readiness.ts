export type DeploySshKeySource = "fleet" | "hostPath" | "missing"

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

export function deriveDeploySshKeyReadiness(params: {
  fleetSshAuthorizedKeys: unknown
  hostProvisioningSshPubkeyFile: unknown
}): { ready: boolean; source: DeploySshKeySource } {
  const fleetKeys = Array.isArray(params.fleetSshAuthorizedKeys)
    ? params.fleetSshAuthorizedKeys
    : []
  const hasFleetKey = fleetKeys.some((key) => hasNonEmptyString(key))
  if (hasFleetKey) return { ready: true, source: "fleet" }
  if (hasNonEmptyString(params.hostProvisioningSshPubkeyFile)) return { ready: true, source: "hostPath" }
  return { ready: false, source: "missing" }
}
