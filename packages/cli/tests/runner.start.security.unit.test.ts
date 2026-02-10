import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
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
});
