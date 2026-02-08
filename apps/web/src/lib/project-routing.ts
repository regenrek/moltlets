const RESERVED_PROJECT_SLUGS = new Set([
  "projects",
  "hosts",
  "api",
  "sign-in",
  "dashboard",
  "settings",
])
const LAST_PROJECT_SLUG_KEY = "clawlets:last-project-slug"

export type ProjectLike = {
  name: string
  updatedAt?: number
  lastSeenAt?: number | null
}

export function slugifyProjectName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!base) return "project"
  if (RESERVED_PROJECT_SLUGS.has(base)) return `${base}-app`
  return base
}

export function getInstanceHostFromWindow(): string {
  if (typeof window === "undefined") return "localhost"
  return window.location.hostname || "localhost"
}

export function parseProjectSlug(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)/)
  const slug = match?.[1] || null
  if (!slug || RESERVED_PROJECT_SLUGS.has(slug)) return null
  return slug
}

export function parseHostName(pathname: string): string | null {
  const match = pathname.match(/^\/[^/]+\/hosts\/([^/]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function buildProjectBasePath(projectSlug: string): string {
  return `/${projectSlug}`
}

export function buildProjectGlobalBase(projectSlug: string): string {
  return `${buildProjectBasePath(projectSlug)}/~`
}

export function buildProjectGlobalPath(projectSlug: string, slug: string): string {
  return `${buildProjectGlobalBase(projectSlug)}/${slug}`
}

export function buildHostsPath(projectSlug: string): string {
  return `${buildProjectBasePath(projectSlug)}/hosts`
}

export function buildHostPath(projectSlug: string, host: string): string {
  return `${buildHostsPath(projectSlug)}/${encodeURIComponent(host)}`
}

const HOST_SWITCH_GLOBAL_MAP = {
  bootstrap: "deploy",
  deploy: "deploy",
  updates: "deploy",
  logs: "logs",
  "server-logs": "logs",
  audit: "audit",
  restart: "restart",
  secrets: "secrets",
  gateways: "gateways",
  runs: "runs",
  settings: "settings",
} as const

export function buildHostSwitchPath(params: {
  projectSlug: string
  host: string
  pathname: string
}): string {
  const base = buildHostPath(params.projectSlug, params.host)
  const parts = params.pathname.split("/").filter(Boolean)
  if (parts[0] !== params.projectSlug) return base
  if (parts[1] === "hosts" && parts[2]) {
    const suffix = parts.slice(3).join("/")
    return suffix ? `${base}/${suffix}` : base
  }
  if (parts[1] === "~") {
    const globalSlug = parts[2] || ""
    const mapped = HOST_SWITCH_GLOBAL_MAP[globalSlug as keyof typeof HOST_SWITCH_GLOBAL_MAP]
    if (mapped) {
      const rest = parts.slice(3).join("/")
      return rest ? `${base}/${mapped}/${rest}` : `${base}/${mapped}`
    }
  }
  return base
}

export function pickLastActiveProject<T extends ProjectLike>(projects: T[]): T | null {
  if (projects.length === 0) return null
  const sorted = [...projects].toSorted((a, b) => {
    const aSeen = typeof a.lastSeenAt === "number" ? a.lastSeenAt : 0
    const bSeen = typeof b.lastSeenAt === "number" ? b.lastSeenAt : 0
    if (aSeen !== bSeen) return bSeen - aSeen
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
  return sorted[0] ?? null
}

export function storeLastProjectSlug(slug: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LAST_PROJECT_SLUG_KEY, slug)
  } catch {
    // ignore storage failures
  }
}

export function readLastProjectSlug(): string | null {
  if (typeof window === "undefined") return null
  try {
    const value = window.localStorage.getItem(LAST_PROJECT_SLUG_KEY)
    return value || null
  } catch {
    return null
  }
}
