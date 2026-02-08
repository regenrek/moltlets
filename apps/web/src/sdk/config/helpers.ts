export const GATEWAY_OPENCLAW_POLICY_MESSAGE = "Gateway openclaw config updates must use gateway endpoints."

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).toSorted()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`
}

function getGatewaysByHost(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainRecord(value)) return {}
  const hosts = value["hosts"]
  if (!isPlainRecord(hosts)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [host, hostCfg] of Object.entries(hosts)) {
    if (!isPlainRecord(hostCfg)) continue
    const gateways = hostCfg["gateways"]
    if (isPlainRecord(gateways)) out[host] = gateways
  }
  return out
}

export function isGatewayOpenclawPath(parts: Array<string | number>): boolean {
  return (
    parts.length >= 5 &&
    parts[0] === "hosts" &&
    typeof parts[1] === "string" &&
    parts[2] === "gateways" &&
    typeof parts[3] === "string" &&
    parts[4] === "openclaw"
  )
}

export function findGatewayOpenclawChanges(
  current: unknown,
  next: unknown,
): { path: Array<string | number>; message: string } | null {
  const currentGatewaysByHost = getGatewaysByHost(current)
  const nextGatewaysByHost = getGatewaysByHost(next)
  const allHosts = new Set([...Object.keys(currentGatewaysByHost), ...Object.keys(nextGatewaysByHost)])
  for (const host of allHosts) {
    const currentGateways = currentGatewaysByHost[host] || {}
    const nextGateways = nextGatewaysByHost[host] || {}
    const allIds = new Set([...Object.keys(currentGateways), ...Object.keys(nextGateways)])
    for (const gatewayId of allIds) {
      const currentGateway = currentGateways[gatewayId]
      const nextGateway = nextGateways[gatewayId]
      const currentOpenclaw = isPlainRecord(currentGateway) ? currentGateway["openclaw"] : undefined
      const nextOpenclaw = isPlainRecord(nextGateway) ? nextGateway["openclaw"] : undefined
      if (currentOpenclaw === undefined && nextOpenclaw === undefined) continue
      if (stableStringify(currentOpenclaw) !== stableStringify(nextOpenclaw)) {
        return { path: ["hosts", host, "gateways", gatewayId, "openclaw"], message: GATEWAY_OPENCLAW_POLICY_MESSAGE }
      }
    }
  }
  return null
}
