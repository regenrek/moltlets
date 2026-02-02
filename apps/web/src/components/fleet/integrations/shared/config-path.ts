export function buildBotConfigPath(botId: string, ...parts: Array<string | number>): string {
  const suffix = parts
    .filter((part) => part !== "")
    .map((part) => String(part))
    .join(".")
  return suffix ? `fleet.bots.${botId}.${suffix}` : `fleet.bots.${botId}`
}
