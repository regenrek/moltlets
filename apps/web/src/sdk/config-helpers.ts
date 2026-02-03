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

function getBotsByHost(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainRecord(value)) return {}
  const hosts = value["hosts"]
  if (!isPlainRecord(hosts)) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const [host, hostCfg] of Object.entries(hosts)) {
    if (!isPlainRecord(hostCfg)) continue
    const bots = hostCfg["bots"]
    if (isPlainRecord(bots)) out[host] = bots
  }
  return out
}

export function isGatewayOpenclawPath(parts: Array<string | number>): boolean {
  return (
    parts.length >= 5 &&
    parts[0] === "hosts" &&
    typeof parts[1] === "string" &&
    parts[2] === "bots" &&
    typeof parts[3] === "string" &&
    parts[4] === "openclaw"
  )
}

export function findGatewayOpenclawChanges(
  current: unknown,
  next: unknown,
): { path: Array<string | number>; message: string } | null {
  const currentBotsByHost = getBotsByHost(current)
  const nextBotsByHost = getBotsByHost(next)
  const allHosts = new Set([...Object.keys(currentBotsByHost), ...Object.keys(nextBotsByHost)])
  for (const host of allHosts) {
    const currentBots = currentBotsByHost[host] || {}
    const nextBots = nextBotsByHost[host] || {}
    const allIds = new Set([...Object.keys(currentBots), ...Object.keys(nextBots)])
    for (const botId of allIds) {
      const currentBot = currentBots[botId]
      const nextBot = nextBots[botId]
      const currentOpenclaw = isPlainRecord(currentBot) ? currentBot["openclaw"] : undefined
      const nextOpenclaw = isPlainRecord(nextBot) ? nextBot["openclaw"] : undefined
      if (currentOpenclaw === undefined && nextOpenclaw === undefined) continue
      if (stableStringify(currentOpenclaw) !== stableStringify(nextOpenclaw)) {
        return { path: ["hosts", host, "bots", botId, "openclaw"], message: GATEWAY_OPENCLAW_POLICY_MESSAGE }
      }
    }
  }
  return null
}
