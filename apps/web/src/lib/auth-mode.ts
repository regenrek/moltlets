const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"])

function parseBooleanEnv(value: unknown): boolean {
  if (typeof value !== "string") return false
  const normalized = value.trim().toLowerCase()
  return TRUE_ENV_VALUES.has(normalized)
}

export function isAuthDisabled(): boolean {
  return parseBooleanEnv(import.meta.env.VITE_CLAWLETS_AUTH_DISABLED)
}

export function canQueryWithAuth(params: {
  sessionUserId: string | null | undefined
  isAuthenticated: boolean
  isSessionPending: boolean
  isAuthLoading: boolean
}): boolean {
  if (isAuthDisabled()) return true
  return Boolean(params.sessionUserId) && params.isAuthenticated && !params.isSessionPending && !params.isAuthLoading
}
