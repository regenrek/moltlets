function stableShortHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function compactPreview(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/g, " ")
  if (!normalized) return ""
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}…`
}

function maskKeyPayload(payload: string): string {
  const normalized = payload.trim()
  if (!normalized) return "…"
  return `…${normalized.slice(-4)}`
}

function maskHostToken(hostsToken: string): string {
  const parts = hostsToken
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (parts.length === 0) return "host"
  const first = compactPreview(parts[0], 20)
  if (parts.length === 1) return first || "host"
  return `${first || "host"} +${parts.length - 1}`
}

export function maskSshPublicKey(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ")
  if (!normalized) return "ssh-key … fp:00000000"

  const parts = normalized.split(" ")
  const type = parts[0] || "ssh-key"
  const payload = parts[1] || ""
  const comment = parts.slice(2).join(" ")
  const fp = stableShortHash(normalized)
  const commentPreview = compactPreview(comment, 12)

  return `${type} ${maskKeyPayload(payload)} fp:${fp}${commentPreview ? ` ${commentPreview}` : ""}`
}

export function maskKnownHostEntry(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ")
  const fp = stableShortHash(normalized)
  if (!normalized) return `known-host … fp:${fp}`

  const parts = normalized.split(" ")
  if (parts.length < 3) return `known-host … fp:${fp}`

  const hasMarker = parts[0]?.startsWith("@")
  const marker = hasMarker ? `${parts[0]} ` : ""
  const hostsToken = hasMarker ? (parts[1] || "") : (parts[0] || "")
  const keyType = hasMarker ? (parts[2] || "ssh-key") : (parts[1] || "ssh-key")
  const keyPayload = hasMarker ? (parts[3] || "") : (parts[2] || "")
  const comment = hasMarker ? parts.slice(4).join(" ") : parts.slice(3).join(" ")
  const commentPreview = compactPreview(comment, 12)

  return `${marker}${maskHostToken(hostsToken)} ${keyType} ${maskKeyPayload(keyPayload)} fp:${fp}${commentPreview ? ` ${commentPreview}` : ""}`
}
