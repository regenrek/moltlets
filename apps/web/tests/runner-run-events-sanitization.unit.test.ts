import { describe, expect, it } from "vitest";
import { sanitizeRunnerRunEventsForStorage } from "../convex/controlPlane/httpParsers";

describe("runner run-events sanitization", () => {
  it("redacts common secret-bearing patterns in messages", () => {
    const safe = sanitizeRunnerRunEventsForStorage([
      {
        ts: 1,
        level: "info",
        message: "Authorization: Bearer abc123 https://user:pw@example.com?a=1&token=t1 password=letmein",
      },
    ]);
    expect(safe).toHaveLength(1);
    expect(safe[0]?.message).toContain("Authorization: Bearer <redacted>");
    expect(safe[0]?.message).toContain("https://<redacted>@example.com?a=1&token=<redacted>");
    expect(safe[0]?.message).toContain("password=<redacted>");
    expect(safe[0]?.redacted).toBe(true);
  });

  it("drops malformed rows and normalizes timestamps", () => {
    const safe = sanitizeRunnerRunEventsForStorage(
      [
        null,
        { level: "trace", message: "ignored" },
        { level: "info", message: "   " },
        { ts: 10.9, level: "warn", message: "ok" },
        { ts: Number.NaN, level: "error", message: "fallback ts" },
      ],
      55,
    );
    expect(safe).toEqual([
      { ts: 10, level: "warn", message: "ok", meta: undefined, redacted: undefined },
      { ts: 55, level: "error", message: "fallback ts", meta: undefined, redacted: undefined },
    ]);
  });

  it("keeps max 200 events", () => {
    const safe = sanitizeRunnerRunEventsForStorage(
      Array.from({ length: 205 }, (_, i) => ({
        ts: i,
        level: "info",
        message: `m${i}`,
      })),
    );
    expect(safe).toHaveLength(200);
    expect(safe[0]?.message).toBe("m0");
    expect(safe[199]?.message).toBe("m199");
  });

  it("sanitizes meta and preserves explicit redacted flag", () => {
    const safe = sanitizeRunnerRunEventsForStorage([
      {
        ts: 1,
        level: "info",
        message: "ok",
        meta: { kind: "phase", phase: "command_start" },
      },
      {
        ts: 2,
        level: "info",
        message: "ok2",
        meta: { kind: "exit", code: 999 },
        redacted: true,
      },
    ]);
    expect(safe[0]?.meta).toEqual({ kind: "phase", phase: "command_start" });
    expect(safe[1]?.meta).toBeUndefined();
    expect(safe[1]?.redacted).toBe(true);
  });
});
