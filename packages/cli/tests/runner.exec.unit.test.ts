import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { execCaptureStdout, execCaptureTail } from "../src/commands/runner/exec.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runner exec", () => {
  it("captures bounded tails and reports truncation", async () => {
    const res = await execCaptureTail({
      cmd: process.execPath,
      args: ["-e", "process.stdout.write('a'.repeat(50));process.stderr.write('b'.repeat(20));"],
      cwd: process.cwd(),
      env: process.env,
      stdin: "ignore",
      maxStdoutBytes: 10,
      maxStderrBytes: 5,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdoutTail).toBe("a".repeat(10));
    expect(res.stderrTail).toBe("b".repeat(5));
    expect(res.stdoutTruncated).toBe(true);
    expect(res.stderrTruncated).toBe(true);
  });

  it("kills a process on timeout (no lingering activity after promise rejects)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-exec-timeout-"));
    const tickFile = path.join(dir, "tick.txt");
    try {
      await fs.writeFile(tickFile, "start", "utf8");
      const code =
        "const fs=require('fs');const f=process.argv[1];process.on('SIGTERM',()=>{});setInterval(()=>{fs.writeFileSync(f,String(Date.now()));},50);";

      await expect(
        execCaptureTail({
          cmd: process.execPath,
          args: ["-e", code, tickFile],
          cwd: process.cwd(),
          env: process.env,
          stdin: "ignore",
          timeoutMs: 100,
          maxStdoutBytes: 0,
          maxStderrBytes: 0,
        }),
      ).rejects.toThrow(/timed out/i);

      const v1 = await fs.readFile(tickFile, "utf8");
      await sleep(200);
      const v2 = await fs.readFile(tickFile, "utf8");
      expect(v2).toBe(v1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("kills a process on stdout overflow (handles SIGTERM-ignoring children)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-exec-overflow-"));
    const tickFile = path.join(dir, "tick.txt");
    try {
      await fs.writeFile(tickFile, "start", "utf8");
      const code =
        "const fs=require('fs');const f=process.argv[1];process.on('SIGTERM',()=>{});process.stdout.write('a'.repeat(10000));setInterval(()=>{fs.writeFileSync(f,String(Date.now()));},50);";

      await expect(
        execCaptureStdout({
          cmd: process.execPath,
          args: ["-e", code, tickFile],
          cwd: process.cwd(),
          env: process.env,
          stdin: "ignore",
          maxStdoutBytes: 100,
          maxStderrBytes: 0,
        }),
      ).rejects.toThrow(/output exceeded/i);

      const v1 = await fs.readFile(tickFile, "utf8");
      await sleep(200);
      const v2 = await fs.readFile(tickFile, "utf8");
      expect(v2).toBe(v1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
