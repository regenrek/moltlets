import { spawn } from "node:child_process";

export type RunOpts = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  redact?: string[];
  stdin?: "inherit" | "ignore";
  timeoutMs?: number;
  maxOutputBytes?: number;
  redactOutput?: boolean;
};

function redactLine(line: string, values?: string[]): string {
  if (!values || values.length === 0) return line;
  let redacted = line;
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    redacted = redacted.split(trimmed).join("<redacted>");
  }
  return redacted;
}

export async function run(
  cmd: string,
  args: string[],
  opts: RunOpts = {},
): Promise<void> {
  if (opts.dryRun) {
    const line = [cmd, ...args].join(" ");
    console.log(redactLine(line, opts.redact));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: "inherit",
    });
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          finish(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    child.on("error", (err) => finish(err as Error));
    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) finish();
      else finish(new Error(`${cmd} exited with code ${code ?? "null"}`));
    });
  });
}

export async function capture(
  cmd: string,
  args: string[],
  opts: RunOpts = {},
): Promise<string> {
  if (opts.dryRun) return "";

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value ?? "");
    };
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const stdinMode = opts.stdin ?? "ignore";
    const stdio: ["inherit" | "ignore", "pipe", "inherit"] =
      stdinMode === "inherit" ? ["inherit", "pipe", "inherit"] : ["ignore", "pipe", "inherit"];
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio,
    });
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          finish(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (buf) => {
      if (opts.maxOutputBytes) {
        totalBytes += buf.length;
        if (totalBytes > opts.maxOutputBytes) {
          child.kill("SIGTERM");
          finish(new Error(`${cmd} output exceeded ${opts.maxOutputBytes} bytes`));
          return;
        }
      }
      chunks.push(Buffer.from(buf));
    });
    child.on("error", (err) => finish(err as Error));
    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        const output = Buffer.concat(chunks).toString("utf8").trim();
        const finalOutput = opts.redactOutput ? redactLine(output, opts.redact) : output;
        finish(undefined, finalOutput);
      }
      else finish(new Error(`${cmd} exited with code ${code ?? "null"}`));
    });
  });
}

export async function captureWithInput(
  cmd: string,
  args: string[],
  input: string,
  opts: RunOpts = {},
): Promise<string> {
  if (opts.dryRun) return "";

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value ?? "");
    };
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          finish(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (buf) => {
      if (opts.maxOutputBytes) {
        totalBytes += buf.length;
        if (totalBytes > opts.maxOutputBytes) {
          child.kill("SIGTERM");
          finish(new Error(`${cmd} output exceeded ${opts.maxOutputBytes} bytes`));
          return;
        }
      }
      chunks.push(Buffer.from(buf));
    });
    child.on("error", (err) => finish(err as Error));
    child.stdin.write(input);
    child.stdin.end();
    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        const output = Buffer.concat(chunks).toString("utf8").trim();
        const finalOutput = opts.redactOutput ? redactLine(output, opts.redact) : output;
        finish(undefined, finalOutput);
      }
      else finish(new Error(`${cmd} exited with code ${code ?? "null"}`));
    });
  });
}
