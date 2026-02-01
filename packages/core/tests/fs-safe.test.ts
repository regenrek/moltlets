import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupFile, writeFileAtomic } from "../src/lib/fs-safe";

describe("fs-safe", () => {
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "clawlets-fs-"));
  });

  afterAll(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {}
  });

  it("creates backups and writes atomically", async () => {
    const file = path.join(dir, "a.txt");
    await writeFile(file, "one\n", "utf8");

    expect(await backupFile(path.join(dir, "missing.txt"))).toBeNull();

    const backup = await backupFile(file);
    expect(backup).toMatch(/\.bak\./);
    expect(await readFile(backup!, "utf8")).toBe("one\n");

    await writeFileAtomic(file, "two\n");
    expect(await readFile(file, "utf8")).toBe("two\n");
  });
});
