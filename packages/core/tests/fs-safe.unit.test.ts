import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs/promises";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupFile, pathExists, writeFileAtomic } from "../src/lib/storage/fs-safe";

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

  it("preserves existing file mode when mode option is omitted", async () => {
    const file = path.join(dir, "mode.txt");
    await writeFile(file, "one\n", "utf8");
    await fs.chmod(file, 0o640);

    await writeFileAtomic(file, "two\n");

    const mode = (await fs.stat(file)).mode & 0o777;
    expect(mode).toBe(0o640);
  });

  it("rethrows non-missing errors from pathExists", async () => {
    const err = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const spy = vi.spyOn(fs, "stat").mockRejectedValueOnce(err as NodeJS.ErrnoException);
    await expect(pathExists(path.join(dir, "blocked"))).rejects.toThrow(/permission denied/i);
    spy.mockRestore();
  });
});
