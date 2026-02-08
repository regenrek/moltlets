import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  __test_createLocalSecretsNonce,
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

  it("generates cryptographically random nonce", () => {
    const a = __test_createLocalSecretsNonce();
    const b = __test_createLocalSecretsNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(32);
    expect(b.length).toBeGreaterThan(32);
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
});
