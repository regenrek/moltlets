export function buildGatewayConfigPath(host: string, botId: string, ...parts: Array<string | number>): string {
  const suffix = parts
    .filter((part) => part !== "")
    .map((part) => String(part))
    .join(".")
  return suffix ? `hosts.${host}.bots.${botId}.${suffix}` : `hosts.${host}.bots.${botId}`
}
