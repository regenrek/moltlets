import type { ClawletsConfig } from "@clawlets/core/lib/clawlets-config"

type ResolveHostOptions = { requireKnownHost?: boolean }

export function resolveHostFromConfig(
  config: ClawletsConfig,
  host: string | null | undefined,
  options: ResolveHostOptions = {},
): string {
  const resolved = host || config.defaultHost || ""
  if (!resolved) throw new Error("missing host")
  if (options.requireKnownHost && !config.hosts[resolved]) throw new Error(`unknown host: ${resolved}`)
  return resolved
}
