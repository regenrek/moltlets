import { z } from "zod";

export type ParsedTtl = { raw: string; seconds: number };

export function parseTtlToSeconds(raw: string): ParsedTtl | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  const m = s.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = String(m[2]).toLowerCase();
  const seconds =
    unit === "s" ? n :
    unit === "m" ? n * 60 :
    unit === "h" ? n * 60 * 60 :
    unit === "d" ? n * 60 * 60 * 24 :
    null;

  if (seconds == null) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  return { raw: s, seconds };
}

export const TtlStringSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    if (!parseTtlToSeconds(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid ttl (expected <n><s|m|h|d>, e.g. 30m, 2h)",
      });
    }
  });
