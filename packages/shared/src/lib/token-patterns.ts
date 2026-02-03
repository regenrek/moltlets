export type TokenPattern = { label: string; regex: RegExp };

export const KNOWN_TOKEN_PATTERNS: TokenPattern[] = [
  { label: "openai sk- token", regex: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { label: "github token", regex: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { label: "github fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: "slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: "google api key", regex: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
];

export function detectKnownToken(value: string): TokenPattern | null {
  const s = String(value || "").trim();
  if (!s) return null;
  for (const p of KNOWN_TOKEN_PATTERNS) {
    if (p.regex.test(s)) return p;
  }
  return null;
}

