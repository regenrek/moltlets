import { spawn } from "node:child_process";
import readline from "node:readline";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RunEventLevel } from "@clawdlets/core/lib/run-types";
import type { ConvexClient } from "./convex";
import { redactLine } from "./redaction";

export type RunManagerEvent = {
  ts: number;
  level: RunEventLevel;
  message: string;
  data?: unknown;
  redacted?: boolean;
};

const active = new Map<string, { child: ReturnType<typeof spawn>; aborted: boolean }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cancelActiveRun(runId: string): boolean {
  const entry = active.get(runId);
  if (!entry) return false;
  entry.aborted = true;
  try {
    entry.child.kill("SIGTERM");
  } catch {
    // ignore
  }
  return true;
}

async function appendEvents(client: ConvexClient, runId: Id<"runs">, events: RunManagerEvent[]): Promise<void> {
  if (events.length === 0) return;
  const payload = {
    runId,
    events: events.map((e) => ({
      ts: e.ts,
      level: e.level,
      message: e.message,
      data: e.data,
      redacted: e.redacted,
    })),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.mutation(api.runEvents.appendBatch, payload);
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(250 * (attempt + 1));
    }
  }
}

export async function runWithEvents(params: {
  client: ConvexClient;
  runId: Id<"runs">;
  redactTokens: string[];
  fn: (emit: (e: Omit<RunManagerEvent, "ts"> & { ts?: number }) => Promise<void>) => Promise<void>;
}): Promise<void> {
  let buffer: RunManagerEvent[] = [];
  const flush = async () => {
    const batch = buffer;
    buffer = [];
    await appendEvents(params.client, params.runId, batch);
  };

  const emit = async (e: Omit<RunManagerEvent, "ts"> & { ts?: number }) => {
    const ts = e.ts ?? Date.now();
    const message = redactLine(e.message, params.redactTokens);
    buffer.push({
      ts,
      level: e.level,
      message,
      data: e.data,
      redacted: message !== e.message || e.redacted,
    });
    if (buffer.length >= 50) await flush();
  };

  try {
    await params.fn(emit);
    await flush();
  } catch (err) {
    try {
      await emit({
        level: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      await flush();
    } catch {
      // ignore secondary errors
    }
    throw err;
  }
}

export async function spawnCommand(params: {
  client: ConvexClient;
  runId: Id<"runs">;
  cwd: string;
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  redactTokens: string[];
}): Promise<void> {
  await runWithEvents({
    client: params.client,
    runId: params.runId,
    redactTokens: params.redactTokens,
    fn: async (emit) => {
      await emit({ level: "info", message: `$ ${params.cmd} ${params.args.join(" ")}` });

      if (active.has(params.runId)) {
        throw new Error("run already active");
      }

      const child = spawn(params.cmd, params.args, {
        cwd: params.cwd,
        env: { ...process.env, ...params.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      active.set(params.runId, { child, aborted: false });

      const onLine = async (level: RunEventLevel, line: string) => {
        const msg = line.trimEnd();
        if (!msg) return;
        await emit({ level, message: msg });
      };

      const stdout = readline.createInterface({ input: child.stdout });
      const stderr = readline.createInterface({ input: child.stderr });
      const pumpStdout = (async () => {
        for await (const line of stdout) await onLine("info", line);
      })();
      const pumpStderr = (async () => {
        for await (const line of stderr) await onLine("warn", line);
      })();

      const exitCode = await new Promise<number>((resolve, reject) => {
        child.on("error", (e) => reject(e));
        child.on("close", (code) => resolve(code ?? 0));
      });

      await Promise.allSettled([pumpStdout, pumpStderr]);

      const entry = active.get(params.runId);
      active.delete(params.runId);
      if (entry?.aborted) throw new Error("run canceled");
      if (exitCode !== 0) throw new Error(`${params.cmd} exited with code ${exitCode}`);
    },
  });
}

export async function spawnCommandCapture(params: {
  client: ConvexClient;
  runId: Id<"runs">;
  cwd: string;
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  redactTokens: string[];
  maxCaptureBytes?: number;
  allowNonZeroExit?: boolean;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let exitCode = 0;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let capturedBytes = 0;

  const pushCaptured = (lines: string[], line: string) => {
    if (!params.maxCaptureBytes) {
      lines.push(line);
      return;
    }
    if (capturedBytes >= params.maxCaptureBytes) return;
    const nextBytes = Buffer.byteLength(line, "utf8") + 1;
    if (capturedBytes + nextBytes > params.maxCaptureBytes) return;
    capturedBytes += nextBytes;
    lines.push(line);
  };

  await runWithEvents({
    client: params.client,
    runId: params.runId,
    redactTokens: params.redactTokens,
    fn: async (emit) => {
      await emit({ level: "info", message: `$ ${params.cmd} ${params.args.join(" ")}` });

      if (active.has(params.runId)) {
        throw new Error("run already active");
      }

      const child = spawn(params.cmd, params.args, {
        cwd: params.cwd,
        env: { ...process.env, ...params.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      active.set(params.runId, { child, aborted: false });

      const onLine = async (level: RunEventLevel, line: string) => {
        const msg = line.trimEnd();
        if (!msg) return;
        await emit({ level, message: msg });
      };

      const stdout = readline.createInterface({ input: child.stdout });
      const stderr = readline.createInterface({ input: child.stderr });
      const pumpStdout = (async () => {
        for await (const line of stdout) {
          pushCaptured(stdoutLines, line);
          await onLine("info", line);
        }
      })();
      const pumpStderr = (async () => {
        for await (const line of stderr) {
          pushCaptured(stderrLines, line);
          await onLine("warn", line);
        }
      })();

      exitCode = await new Promise<number>((resolve, reject) => {
        child.on("error", (e) => reject(e));
        child.on("close", (code) => resolve(code ?? 0));
      });

      await Promise.allSettled([pumpStdout, pumpStderr]);

      const entry = active.get(params.runId);
      active.delete(params.runId);
      if (entry?.aborted) throw new Error("run canceled");

      if (exitCode !== 0 && !params.allowNonZeroExit) {
        throw new Error(`${params.cmd} exited with code ${exitCode}`);
      }
      if (exitCode !== 0 && params.allowNonZeroExit) {
        await emit({ level: "warn", message: `${params.cmd} exited with code ${exitCode}` });
      }
    },
  });

  return {
    exitCode,
    stdout: stdoutLines.join("\n").trim(),
    stderr: stderrLines.join("\n").trim(),
  };
}
