type ConnectionLateHydrationInput = {
  configLoaded: boolean
  draftAdminCidr: unknown
  draftSshAuthorizedKeys: unknown
  hostAdminCidr: unknown
  fleetSshKeys: unknown
  currentAdminCidr: string
  currentKnownKeys: string[]
  currentSelectedKeys: string[]
}

type ConnectionLateHydrationResult = {
  adminCidr?: string
  knownKeys?: string[]
  selectedKeys?: string[]
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toUniqueStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((entry) => toTrimmedString(entry)).filter(Boolean)))
}

export function deriveConnectionLateHydration(
  input: ConnectionLateHydrationInput,
): ConnectionLateHydrationResult | null {
  if (!input.configLoaded) return null

  const result: ConnectionLateHydrationResult = {}
  const draftAdminCidr = toTrimmedString(input.draftAdminCidr)
  const hostAdminCidr = toTrimmedString(input.hostAdminCidr)
  const currentAdminCidr = toTrimmedString(input.currentAdminCidr)
  if (!draftAdminCidr && !currentAdminCidr && hostAdminCidr) {
    result.adminCidr = hostAdminCidr
  }

  const draftKeys = toUniqueStringList(input.draftSshAuthorizedKeys)
  const currentKnownKeys = toUniqueStringList(input.currentKnownKeys)
  const currentSelectedKeys = toUniqueStringList(input.currentSelectedKeys)
  if (draftKeys.length === 0 && currentKnownKeys.length === 0 && currentSelectedKeys.length === 0) {
    const fleetKeys = toUniqueStringList(input.fleetSshKeys)
    if (fleetKeys.length > 0) {
      result.knownKeys = fleetKeys
      result.selectedKeys = fleetKeys
    }
  }

  if (result.adminCidr || result.knownKeys || result.selectedKeys) return result
  return null
}

