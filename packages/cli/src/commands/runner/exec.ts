import { spawn } from "node:child_process";

const KILL_GRACE_MS = 500;

type TailCapture = {
  readonly truncated: boolean;
  push: (buf: Buffer) => void;
  toBuffer: () => Buffer;
};

function createTailCapture(maxBytes: number): TailCapture {
  const limit = Math.max(0, Math.trunc(maxBytes));
  let truncated = false;
  const chunks: Buffer[] = [];
  let bytes = 0;

  const push = (buf: Buffer) => {
    if (limit === 0) {
      if (buf.length > 0) truncated = true;
      return;
    }
    if (buf.length >= limit) {
      chunks.length = 0;
      chunks.push(buf.subarray(buf.length - limit));
      bytes = limit;
      truncated = true;
      return;
    }
    chunks.push(buf);
    bytes += buf.length;
    while (bytes > limit) {
      const first = chunks[0];
      if (!first) break;
      const over = bytes - limit;
      if (first.length <= over) {
        chunks.shift();
        bytes -= first.length;
        truncated = true;
        continue;
      }
      chunks[0] = first.subarray(over);
      bytes -= over;
      truncated = true;
      break;
    }
  };

  const toBuffer = () => (chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks));

  return {
    get truncated() {
      return truncated;
    },
    push,
    toBuffer,
  };
}

export type ExecCaptureTailResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export async function execCaptureTail(params: {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: "ignore" | "inherit";
  timeoutMs?: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}): Promise<ExecCaptureTailResult> {
  const startedAt = Date.now();

  return await new Promise<ExecCaptureTailResult>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    let killTimeout: NodeJS.Timeout | null = null;
    let terminateError: Error | null = null;
    const stdout = createTailCapture(params.maxStdoutBytes);
    const stderr = createTailCapture(params.maxStderrBytes);

    const clearTimers = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (killTimeout) {
        clearTimeout(killTimeout);
        killTimeout = null;
      }
    };

    const finish = (err?: Error, result?: Omit<ExecCaptureTailResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (err) reject(err);
      else {
        resolve({
          ...(result as Omit<ExecCaptureTailResult, "durationMs">),
          durationMs: Math.max(0, Date.now() - startedAt),
        });
      }
    };

    const child = spawn(params.cmd, params.args, {
      cwd: params.cwd,
      env: params.env,
      stdio: [params.stdin ?? "ignore", "pipe", "pipe"],
    });

    const terminate = (err: Error) => {
      if (terminateError) return;
      terminateError = err;
      try {
        child.kill("SIGTERM");
      } catch {
        // best effort
      }
      killTimeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, KILL_GRACE_MS);
    };

    if (params.timeoutMs) {
      const timeoutMs = Math.max(1, Math.trunc(params.timeoutMs));
      timeout = setTimeout(() => {
        terminate(new Error(`${params.cmd} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.on("error", (err) => finish(err as Error));
    child.stdout?.on("data", (buf: Buffer) => {
      if (terminateError) return;
      stdout.push(buf);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      if (terminateError) return;
      stderr.push(buf);
    });
    child.on("close", (exitCode, signal) => {
      const result = {
        exitCode,
        signal,
        stdoutTail: stdout.toBuffer().toString("utf8").trim(),
        stderrTail: stderr.toBuffer().toString("utf8").trim(),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      };
      if (terminateError) {
        (terminateError as any).cause = { exitCode, signal };
        finish(terminateError);
        return;
      }
      finish(undefined, result);
    });
  });
}

export type ExecCaptureStdoutResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderrTail: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export async function execCaptureStdout(params: {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: "ignore" | "inherit";
  timeoutMs?: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}): Promise<ExecCaptureStdoutResult> {
  const stdoutLimit = Math.max(0, Math.trunc(params.maxStdoutBytes));
  if (stdoutLimit <= 0) throw new Error("maxStdoutBytes must be > 0");
  const startedAt = Date.now();

  return await new Promise<ExecCaptureStdoutResult>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    let killTimeout: NodeJS.Timeout | null = null;
    let terminateError: Error | null = null;
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    const stderr = createTailCapture(params.maxStderrBytes);

    const clearTimers = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (killTimeout) {
        clearTimeout(killTimeout);
        killTimeout = null;
      }
    };

    const finish = (err?: Error, result?: Omit<ExecCaptureStdoutResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (err) reject(err);
      else {
        resolve({
          ...(result as Omit<ExecCaptureStdoutResult, "durationMs">),
          durationMs: Math.max(0, Date.now() - startedAt),
        });
      }
    };

    const child = spawn(params.cmd, params.args, {
      cwd: params.cwd,
      env: params.env,
      stdio: [params.stdin ?? "ignore", "pipe", "pipe"],
    });

    const terminate = (err: Error) => {
      if (terminateError) return;
      terminateError = err;
      try {
        child.kill("SIGTERM");
      } catch {
        // best effort
      }
      killTimeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // best effort
        }
      }, KILL_GRACE_MS);
    };

    if (params.timeoutMs) {
      const timeoutMs = Math.max(1, Math.trunc(params.timeoutMs));
      timeout = setTimeout(() => {
        terminate(new Error(`${params.cmd} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.on("error", (err) => finish(err as Error));
    child.stdout?.on("data", (buf: Buffer) => {
      if (terminateError) return;
      stdoutBytes += buf.length;
      if (stdoutBytes > stdoutLimit) {
        stdoutTruncated = true;
        terminate(new Error(`${params.cmd} output exceeded ${stdoutLimit} bytes`));
        return;
      }
      stdoutChunks.push(buf);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      if (terminateError) return;
      stderr.push(buf);
    });
    child.on("close", (exitCode, signal) => {
      if (terminateError) {
        (terminateError as any).cause = { exitCode, signal };
        finish(terminateError);
        return;
      }
      const stdoutText = stdoutChunks.length === 0 ? "" : Buffer.concat(stdoutChunks).toString("utf8").trim();
      finish(undefined, {
        exitCode,
        signal,
        stdout: stdoutText,
        stderrTail: stderr.toBuffer().toString("utf8").trim(),
        stdoutTruncated,
        stderrTruncated: stderr.truncated,
      });
    });
  });
}
