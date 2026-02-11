import type { Id } from "../../../convex/_generated/dataModel"
import { configDotGet } from "~/sdk/config/dot-get"

export type RepoProbeState = "idle" | "checking" | "ok" | "error"

export type SetupConfig = {
  hosts: Record<string, Record<string, unknown>>
  fleet: {
    sshAuthorizedKeys: unknown[]
  }
}

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

function decodeSetupConfig(params: {
  hostsValue: unknown
  sshKeysValue: unknown
}): SetupConfig {
  return {
    hosts: coerceHosts(params.hostsValue),
    fleet: {
      sshAuthorizedKeys: Array.isArray(params.sshKeysValue) ? params.sshKeysValue : [],
    },
  }
}

export async function loadSetupConfig(projectId: Id<"projects">): Promise<SetupConfig> {
  const [hostsNode, sshKeysNode] = await withTimeout(
    Promise.all([
      configDotGet({
        data: {
          projectId,
          path: "hosts",
        },
      }),
      configDotGet({
        data: {
          projectId,
          path: "fleet.sshAuthorizedKeys",
        },
      }),
    ]),
    35_000,
    "Repo probe timed out while checking config access. Ensure runner is idle and retry.",
  )
  return decodeSetupConfig({
    hostsValue: hostsNode.value,
    sshKeysValue: sshKeysNode.value,
  })
}

export function deriveRepoProbeState(params: {
  runnerOnline: boolean
  hasConfig: boolean
  hasError: boolean
}): RepoProbeState {
  if (!params.runnerOnline) return "idle"
  if (params.hasConfig) return "ok"
  if (params.hasError) return "error"
  return "checking"
}

export type RunnerHeaderState = "offline" | "connecting" | "ready"

export function deriveRunnerHeaderState(params: {
  runnerOnline: boolean
  repoProbeState: RepoProbeState
}): RunnerHeaderState {
  if (!params.runnerOnline) return "offline"
  if (params.repoProbeState === "ok") return "ready"
  return "connecting"
}
