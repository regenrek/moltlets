export const GATEWAY_OPENCLAW_POLICY_MESSAGE = "Bot openclaw config updates must use bot endpoints."

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`
}

function getGateways(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return {}
  const fleet = value["fleet"]
  if (!isPlainRecord(fleet)) return {}
  const gateways = fleet["gateways"]
  return isPlainRecord(gateways) ? gateways : {}
}

export function isGatewayOpenclawPath(parts: Array<string | number>): boolean {
  return (
    parts.length >= 4 &&
    parts[0] === "fleet" &&
    parts[1] === "gateways" &&
    typeof parts[2] === "string" &&
    parts[3] === "openclaw"
  )
}

export function findGatewayOpenclawChanges(
  current: unknown,
  next: unknown,
): { path: Array<string | number>; message: string } | null {
  const currentGateways = getGateways(current)
  const nextGateways = getGateways(next)
  const allIds = new Set([...Object.keys(currentGateways), ...Object.keys(nextGateways)])
  for (const gatewayId of allIds) {
    const currentGateway = currentGateways[gatewayId]
    const nextGateway = nextGateways[gatewayId]
    const currentOpenclaw = isPlainRecord(currentGateway) ? currentGateway["openclaw"] : undefined
    const nextOpenclaw = isPlainRecord(nextGateway) ? nextGateway["openclaw"] : undefined
    if (currentOpenclaw === undefined && nextOpenclaw === undefined) continue
    if (stableStringify(currentOpenclaw) !== stableStringify(nextOpenclaw)) {
      return { path: ["fleet", "gateways", gatewayId, "openclaw"], message: GATEWAY_OPENCLAW_POLICY_MESSAGE }
    }
  }
  return null
}
