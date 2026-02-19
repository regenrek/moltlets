export type AuthErrorReason =
  | "ensure_current_required"
  | "sign_in_required"
  | "invalid_auth_user"

function getErrorData(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  const data = e["data"];
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function getErrorCode(error: unknown): string {
  const data = getErrorData(error);
  if (!data) return "";
  const code = data["code"];
  return typeof code === "string" ? code : "";
}

function getErrorMessage(error: unknown): string {
  const data = getErrorData(error);
  const dataMessage = data ? data["message"] : null;
  if (typeof dataMessage === "string") return dataMessage;
  if (!error || typeof error !== "object") return "";
  const e = error as Record<string, unknown>;
  const message = e["message"];
  return typeof message === "string" ? message : "";
}

export function getAuthErrorReason(error: unknown): AuthErrorReason | null {
  const data = getErrorData(error);
  if (!data) return null;
  const reason = data["reason"];
  if (
    reason === "ensure_current_required" ||
    reason === "sign_in_required" ||
    reason === "invalid_auth_user"
  ) {
    return reason;
  }
  return null;
}

export function isAuthError(error: unknown): boolean {
  if (getAuthErrorReason(error)) return true;
  const code = getErrorCode(error);
  if (code === "unauthorized") return true;
  return getErrorMessage(error).toLowerCase().includes("unauth");
}

export function isEnsureCurrentRequiredError(error: unknown): boolean {
  if (getAuthErrorReason(error) === "ensure_current_required") return true;
  return getErrorMessage(error).toLowerCase().includes("users.ensurecurrent");
}

export function shouldRetryQueryError(failureCount: number, error: unknown): boolean {
  if (isAuthError(error)) return false;
  return failureCount < 3;
}
