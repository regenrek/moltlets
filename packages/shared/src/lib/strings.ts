export function coerceString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

export function coerceTrimmedString(value: unknown): string {
  return coerceString(value).trim();
}

export function formatUnknown(value: unknown, fallback = ""): string {
  if (value instanceof Error && typeof value.message === "string") {
    const msg = value.message.trim();
    if (msg) return msg;
  }
  const primitive = coerceTrimmedString(value);
  if (primitive) return primitive;
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded === "string" && encoded !== "{}" && encoded !== "[]") return encoded;
  } catch {
    // Ignore JSON serialization errors and return fallback.
  }
  return fallback;
}
