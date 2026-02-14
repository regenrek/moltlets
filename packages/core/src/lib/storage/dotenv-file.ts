import dotenv from "dotenv";

export type DotenvMap = Record<string, string>;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseDotenv(text: string): DotenvMap {
  return dotenv.parse(text);
}

export function formatDotenvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (/[\r\n]/.test(trimmed)) {
    throw new Error("dotenv values cannot contain newlines");
  }

  // Safer default: quote when characters could confuse dotenv parsing.
  // NOTE: dotenv does NOT unescape `\"` inside double-quoted values. That means
  // JSON.stringify() corrupts values that contain `"`, including JSON payloads.
  // Use single quotes in that case.
  if (/[\s#'`$]/.test(trimmed)) {
    if (trimmed.includes('\"')) {
      if (trimmed.includes("'")) {
        throw new Error("dotenv values cannot contain both single and double quotes");
      }
      return `'${trimmed}'`;
    }
    return JSON.stringify(trimmed);
  }
  return trimmed;
}

export function upsertDotenv(text: string, updates: DotenvMap): string {
  const keys = Object.keys(updates);
  const present = new Set<string>();
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized === "" ? [] : normalized.split("\n");
  const out = lines.map((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) return line;
    const key = m[1]!;
    if (!(key in updates)) return line;
    present.add(key);
    return `${key}=${formatDotenvValue(updates[key]!)}`;
  });

  const missing = keys.filter((k) => !present.has(k));
  if (missing.length === 0) {
    const joined = out.join("\n");
    return joined === "" ? "" : joined.replace(/\n+$/, "\n");
  }

  const needsBlankLine = out.length > 0 && out[out.length - 1]!.trim() !== "";
  const base = out.length === 0 ? [] : out;
  const appended = [
    ...base,
    ...(needsBlankLine ? [""] : []),
    ...missing.map((k) => `${k}=${formatDotenvValue(updates[k]!)}`),
    "",
  ];
  return appended.join("\n");
}

export function redactDotenv(text: string, keysToRedact: string[]): string {
  let out = text;
  for (const k of keysToRedact) {
    const rx = new RegExp(`^(${escapeRegex(k)}=).*$`, "gm");
    out = out.replace(rx, `$1"***REDACTED***"`);
  }
  return out;
}
