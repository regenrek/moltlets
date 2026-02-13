export function canQueryWithAuth(params: {
  sessionUserId: string | null | undefined
  isAuthenticated: boolean
  isSessionPending: boolean
  isAuthLoading: boolean
}): boolean {
  return Boolean(params.sessionUserId) && params.isAuthenticated && !params.isSessionPending && !params.isAuthLoading
}
