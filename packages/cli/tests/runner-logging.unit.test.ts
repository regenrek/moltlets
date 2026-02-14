import path from "node:path";
import { describe, expect, it } from "vitest";

describe("runner logging", () => {
  it("parses log levels with fallback", async () => {
    const { parseLogLevel } = await import("../src/lib/logging/logger.js");
    expect(parseLogLevel("", "info")).toBe("info");
    expect(parseLogLevel("DEBUG", "info")).toBe("debug");
    expect(parseLogLevel(undefined, "warn")).toBe("warn");
    expect(() => parseLogLevel("verbose", "info")).toThrow(/invalid log level/i);
  });

  it("sanitizes file segments", async () => {
    const { safeFileSegment } = await import("../src/lib/logging/logger.js");
    expect(safeFileSegment("openclaw-fleet-host", "x")).toBe("openclaw-fleet-host");
    expect(safeFileSegment("a b/c", "x")).toBe("a_b_c");
    expect(safeFileSegment("   ", "fallback")).toBe("fallback");
    expect(safeFileSegment("x".repeat(200), "x", 10)).toHaveLength(10);
  });

  it("resolves default runner log file path", async () => {
    const { resolveRunnerLogFile } = await import("../src/lib/logging/logger.js");
    const filePath = resolveRunnerLogFile({
      runtimeDir: "/tmp/clawlets-runtime",
      projectId: "proj123",
      runnerName: "kevin-mbp",
    });
    expect(filePath).toBe(path.join("/tmp/clawlets-runtime", "logs", "runner", "proj123-kevin-mbp.jsonl"));
  });

  it("creates a logger without file sink", async () => {
    const { createRunnerLogger } = await import("../src/lib/logging/logger.js");
    const logger = createRunnerLogger({ level: "info", logToFile: false });
    expect(typeof logger.info).toBe("function");
    logger.info({ ok: true }, "smoke");
  });
});

