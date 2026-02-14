export type ProjectTokenKeyringEntry = {
  id: string
  label: string
  value: string
}

export type ProjectTokenKeyring = {
  items: ProjectTokenKeyringEntry[]
}

export const PROJECT_TOKEN_KEYRING_MAX_ITEMS = 64
export const PROJECT_TOKEN_KEY_ID_MAX_CHARS = 64
export const PROJECT_TOKEN_KEY_LABEL_MAX_CHARS = 80
export const PROJECT_TOKEN_VALUE_MAX_CHARS = 4096
export const PROJECT_TOKEN_KEYRING_MAX_SERIALIZED_CHARS = 256 * 1024

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function trimBounded(value: unknown, maxChars: number): string {
  const normalized = trim(value)
  if (!normalized) return ""
  return normalized.slice(0, maxChars)
}

function normalizeLabel(rawLabel: string, value: string): string {
  const next = rawLabel.trim()
  if (next) return next
  const head = value.trim().slice(0, 6)
  const tail = value.trim().slice(-4)
  if (head && tail) return `Key ${head}...${tail}`
  return "Key"
}

function normalizeEntry(raw: unknown): ProjectTokenKeyringEntry | null {
  const obj = asRecord(raw)
  if (!obj) return null

  const id = trimBounded(obj.id, PROJECT_TOKEN_KEY_ID_MAX_CHARS)
  const value = trim(obj.value)
  if (!id || !value) return null
  if (value.length > PROJECT_TOKEN_VALUE_MAX_CHARS) return null

  const label = normalizeLabel(trimBounded(obj.label, PROJECT_TOKEN_KEY_LABEL_MAX_CHARS), value)
  return { id, label, value }
}

export function parseProjectTokenKeyring(raw: unknown): ProjectTokenKeyring {
  const json = trim(raw)
  if (!json) return { items: [] }
  if (json.length > PROJECT_TOKEN_KEYRING_MAX_SERIALIZED_CHARS) return { items: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { items: [] }
  }

  const root = asRecord(parsed)
  if (!root) return { items: [] }
  const rows = Array.isArray(root.items) ? root.items : []

  const seen = new Set<string>()
  const out: ProjectTokenKeyringEntry[] = []
  for (const row of rows) {
    if (out.length >= PROJECT_TOKEN_KEYRING_MAX_ITEMS) break
    const normalized = normalizeEntry(row)
    if (!normalized) continue
    if (seen.has(normalized.id)) continue
    seen.add(normalized.id)
    out.push(normalized)
  }

  return { items: out }
}

export function serializeProjectTokenKeyring(keyring: ProjectTokenKeyring): string {
  const seen = new Set<string>()
  const normalizedItems: ProjectTokenKeyringEntry[] = []

  for (const entry of keyring.items) {
    if (normalizedItems.length >= PROJECT_TOKEN_KEYRING_MAX_ITEMS) break
    const normalized = normalizeEntry(entry)
    if (!normalized) continue
    if (seen.has(normalized.id)) continue
    seen.add(normalized.id)
    normalizedItems.push(normalized)
  }

  const json = JSON.stringify({ items: normalizedItems })
  if (json.length > PROJECT_TOKEN_KEYRING_MAX_SERIALIZED_CHARS) {
    throw new Error("project token keyring exceeds size limit")
  }
  return json
}

export function resolveActiveProjectTokenEntry(params: {
  keyring: ProjectTokenKeyring
  activeId: string
}): ProjectTokenKeyringEntry | null {
  const requested = params.activeId.trim()
  const byId = requested
    ? params.keyring.items.find((row) => row.id === requested)
    : undefined
  return byId ?? params.keyring.items[0] ?? null
}

export function maskProjectToken(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return "********"
  return `${trimmed.slice(0, 4)}******${trimmed.slice(-4)}`
}

export function generateProjectTokenKeyId(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)

  const randomPart = (() => {
    const maybeCrypto = globalThis.crypto
    if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
      return maybeCrypto.randomUUID().replace(/-/g, "").slice(0, 8)
    }
    return Math.random().toString(36).slice(2, 10)
  })()

  return `${base || "key"}-${randomPart}`
}
