function normalizeBaseUrl(value: string): string {
  const trimmed = String(value || "").trim().replace(/\/+$/, "")
  return trimmed
}

export const DOCS_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_DOCS_URL || "https://docs.clawlets.com")

export function docsUrl(path: string): string {
  const base = DOCS_BASE_URL
  const trimmed = String(path || "").trim()
  if (!trimmed) return base
  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return `${base}${normalizedPath}`
}

export const DOCS_TAILSCALE_AUTH_KEY_URL = docsUrl("/dashboard/tailscale-auth-key")

