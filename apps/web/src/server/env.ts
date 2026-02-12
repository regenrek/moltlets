const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"])

function parseBooleanEnv(value: unknown): boolean {
  if (typeof value !== "string") return false
  const normalized = value.trim().toLowerCase()
  return TRUE_ENV_VALUES.has(normalized)
}

export function isAuthDisabled(): boolean {
  return parseBooleanEnv(process.env["CLAWLETS_AUTH_DISABLED"] || process.env["VITE_CLAWLETS_AUTH_DISABLED"])
}

export function hasAuthEnv(): boolean {
  if (isAuthDisabled()) return true
  const siteUrl = String(process.env["SITE_URL"] || "").trim()
  const secret = String(process.env["BETTER_AUTH_SECRET"] || "").trim()
  const convexUrl = String(process.env["VITE_CONVEX_URL"] || process.env["CONVEX_URL"] || "").trim()
  const convexSiteUrl = String(
    process.env["VITE_CONVEX_SITE_URL"] || process.env["CONVEX_SITE_URL"] || "",
  ).trim()
  return Boolean(siteUrl && secret && convexUrl && convexSiteUrl)
}

export function assertAuthEnv(): void {
  if (isAuthDisabled()) return
  if (hasAuthEnv()) return
  throw new Error("missing SITE_URL, BETTER_AUTH_SECRET, VITE_CONVEX_URL, VITE_CONVEX_SITE_URL")
}
