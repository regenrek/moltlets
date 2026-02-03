export function buildGatewayConfigPath(botId: string, ...parts: Array<string | number>): string {
  const suffix = parts
    .filter((part) => part !== "")
    .map((part) => String(part))
    .join(".")
  return suffix ? `fleet.gateways.${botId}.${suffix}` : `fleet.gateways.${botId}`
}
