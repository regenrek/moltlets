import type { Id } from "../../../convex/_generated/dataModel"
import { configDotMultiGet, type ConfigDotMultiGetResponse } from "~/sdk/config/dot-get"

export type SetupConfig = {
  hosts: Record<string, Record<string, unknown>>
  fleet: {
    sshAuthorizedKeys: unknown[]
  }
}

export const SETUP_CONFIG_PROBE_STALE_MS = 120_000
export const SETUP_CONFIG_PROBE_GC_MS = 300_000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function coerceHosts(value: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const row = asRecord(value)
  if (!row) return out
  for (const [hostName, hostValue] of Object.entries(row)) {
    const hostRow = asRecord(hostValue)
    if (!hostRow) continue
    out[hostName] = hostRow
  }
  return out
}

function decodeSetupConfig(values: ConfigDotMultiGetResponse["values"]): SetupConfig {
  return {
    hosts: coerceHosts(values["hosts"]),
    fleet: {
      sshAuthorizedKeys: Array.isArray(values["fleet.sshAuthorizedKeys"]) ? values["fleet.sshAuthorizedKeys"] : [],
    },
  }
}

export async function loadSetupConfig(projectId: Id<"projects">): Promise<SetupConfig> {
  const values = await withTimeout(
    configDotMultiGet({
      data: {
        projectId,
        paths: ["hosts", "fleet.sshAuthorizedKeys"],
      },
    }),
    35_000,
    "Repo probe timed out while checking config access. Ensure runner is idle and retry.",
  )
  return decodeSetupConfig(values.values)
}

export function setupConfigProbeQueryKey(projectId: Id<"projects"> | null | undefined) {
  return ["setupConfigProbe", projectId] as const
}

export function setupConfigProbeQueryOptions(projectId: Id<"projects"> | null | undefined) {
  return {
    queryKey: setupConfigProbeQueryKey(projectId),
    queryFn: async () => {
      if (!projectId) throw new Error("missing project id")
      return await loadSetupConfig(projectId)
    },
    staleTime: SETUP_CONFIG_PROBE_STALE_MS,
    gcTime: SETUP_CONFIG_PROBE_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
}
