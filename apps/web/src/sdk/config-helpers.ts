export const BOT_OPENCLAW_POLICY_MESSAGE = "Bot openclaw config updates must use bot endpoints."

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

function getBots(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return {}
  const fleet = value["fleet"]
  if (!isPlainRecord(fleet)) return {}
  const bots = fleet["bots"]
  return isPlainRecord(bots) ? bots : {}
}

export function isBotOpenclawPath(parts: Array<string | number>): boolean {
  return (
    parts.length >= 4 &&
    parts[0] === "fleet" &&
    parts[1] === "bots" &&
    typeof parts[2] === "string" &&
    parts[3] === "openclaw"
  )
}

export function findBotOpenclawChanges(
  current: unknown,
  next: unknown,
): { path: Array<string | number>; message: string } | null {
  const currentBots = getBots(current)
  const nextBots = getBots(next)
  const allIds = new Set([...Object.keys(currentBots), ...Object.keys(nextBots)])
  for (const botId of allIds) {
    const currentBot = currentBots[botId]
    const nextBot = nextBots[botId]
    const currentOpenclaw = isPlainRecord(currentBot) ? currentBot["openclaw"] : undefined
    const nextOpenclaw = isPlainRecord(nextBot) ? nextBot["openclaw"] : undefined
    if (currentOpenclaw === undefined && nextOpenclaw === undefined) continue
    if (stableStringify(currentOpenclaw) !== stableStringify(nextOpenclaw)) {
      return { path: ["fleet", "bots", botId, "openclaw"], message: BOT_OPENCLAW_POLICY_MESSAGE }
    }
  }
  return null
}
