import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  __test_assertSecureRunnerTempFile,
  __test_cleanupStaleRunnerTempFiles,
  __test_sanitizeRunnerControlPlaneErrorMessage,
  __test_writeInputJsonTemp,
  __test_writeSecretsJsonTemp,
} from "../src/commands/runner/start.js";

async function modeBits(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.mode & 0o777;
}

describe("runner start security", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created.map(async (filePath) => {
        await fs.rm(filePath, { force: true });
      }),
    );
    created.length = 0;
  });

  it("writes temp input files with 0600 permissions", async () => {
    const filePath = await __test_writeInputJsonTemp("job1", { A: "1" });
    created.push(filePath);
    expect(await modeBits(filePath)).toBe(0o600);
  });

  it("writes temp secrets files with 0600 permissions", async () => {
    const filePath = await __test_writeSecretsJsonTemp("job1", { adminPasswordHash: "hash", API_KEY: "secret" });
    created.push(filePath);
    expect(await modeBits(filePath)).toBe(0o600);
  });

  it("omits empty adminPasswordHash from secrets payload", async () => {
    const filePath = await __test_writeSecretsJsonTemp("job1", {
      adminPasswordHash: "",
      API_KEY: "secret",
    });
    created.push(filePath);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { adminPasswordHash?: string; secrets?: Record<string, string> };
    expect(parsed.adminPasswordHash).toBeUndefined();
    expect(parsed.secrets).toEqual({ API_KEY: "secret" });
  });

  it("rejects temp files that do not keep 0600 mode", async () => {
    const filePath = await __test_writeInputJsonTemp("job1", { A: "1" });
    created.push(filePath);
    await fs.chmod(filePath, 0o644);
    await expect(__test_assertSecureRunnerTempFile(filePath)).rejects.toThrow(/mode/i);
  });

  it("cleans stale runner temp files from dead pids", async () => {
    const deadPid = String(process.pid + 700_000);
    const filePath = path.join(os.tmpdir(), `clawlets-runner-secrets.job1.${deadPid}.${randomUUID()}.json`);
    await fs.writeFile(filePath, "{\"a\":\"b\"}\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    created.push(filePath);

    await __test_cleanupStaleRunnerTempFiles();
    await expect(fs.stat(filePath)).rejects.toThrow();
  });

  it("keeps temp files from the active process", async () => {
    const filePath = path.join(os.tmpdir(), `clawlets-runner-input.job1.${process.pid}.${randomUUID()}.json`);
    await fs.writeFile(filePath, "{\"a\":\"b\"}\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    created.push(filePath);

    await __test_cleanupStaleRunnerTempFiles();
    await expect(fs.stat(filePath)).resolves.toBeTruthy();
  });

  it("redacts secret-looking substrings from control-plane error messages", () => {
    const raw = "Authorization: Bearer token123 https://user:pw@example.com?token=abc password=abc";
    const message = __test_sanitizeRunnerControlPlaneErrorMessage(raw, "fallback");
    expect(message).toContain("Authorization: Bearer <redacted>");
    expect(message).toContain("https://<redacted>@example.com?token=<redacted>");
    expect(message).toContain("password=<redacted>");
    expect(message).not.toContain("token123");
    expect(message).not.toContain("user:pw");
  });
});
