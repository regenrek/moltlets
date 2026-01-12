const DISALLOWED_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function splitDotPath(p0: string): string[] {
  const p = p0.trim();
  if (!p) throw new Error("missing --path");
  const parts = p
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("invalid --path");
  for (const part of parts) {
    if (DISALLOWED_SEGMENTS.has(part)) {
      throw new Error(`invalid --path segment: ${part}`);
    }
  }
  return parts;
}
