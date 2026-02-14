import fs from "node:fs";
import path from "node:path";
import pino, { type DestinationStream, type Logger } from "pino";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LOG_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(["fatal", "error", "warn", "info", "debug", "trace"]);

export function parseLogLevel(raw: unknown, fallback: LogLevel): LogLevel {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (LOG_LEVELS.has(normalized as LogLevel)) return normalized as LogLevel;
  throw new Error(`invalid log level: ${normalized}`);
}

export function safeFileSegment(raw: unknown, fallback: string, maxLen = 80): string {
  const trimmed = String(raw ?? "").trim();
  const replaced = trimmed.replace(/[^A-Za-z0-9._-]/g, "_");
  const collapsed = replaced.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const clipped = collapsed.slice(0, Math.max(1, Math.trunc(maxLen)));
  return clipped || fallback;
}

export function resolveRunnerLogFile(params: { runtimeDir: string; projectId: string; runnerName: string }): string {
  const dir = path.join(params.runtimeDir, "logs", "runner");
  const fileName = `${safeFileSegment(params.projectId, "project")}-${safeFileSegment(params.runnerName, "runner")}.jsonl`;
  return path.join(dir, fileName);
}

export function createRunnerLogger(params: {
  level: LogLevel;
  logToFile: boolean;
  logFilePath?: string;
  bindings?: Record<string, unknown>;
}): Logger {
  const streams: Array<{ stream: DestinationStream }> = [{ stream: pino.destination(1) }];

  if (params.logToFile) {
    const logFilePath = String(params.logFilePath || "").trim();
    if (!logFilePath) throw new Error("log file path required when file logging enabled");
    const resolved = path.resolve(logFilePath);
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Ensure the log file exists and is owner-only readable/writeable.
    const fd = fs.openSync(resolved, "a", 0o600);
    fs.closeSync(fd);
    fs.chmodSync(resolved, 0o600);
    streams.push({ stream: pino.destination({ dest: resolved, sync: false }) });
  }

  const logger = pino(
    {
      name: "clawlets-runner",
      level: params.level,
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: pino.stdSerializers.err },
    },
    pino.multistream(streams),
  );

  return params.bindings ? logger.child(params.bindings) : logger;
}
