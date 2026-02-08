import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileSystemConfigStore } from "../src/lib/storage/fs-config-store";

describe("FileSystemConfigStore", () => {
  let dir = "";
  const store = new FileSystemConfigStore();

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "clawlets-config-store-"));
  });

  afterAll(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {}
  });

  it("reads and writes text atomically", async () => {
    const filePath = path.join(dir, "fleet", "clawlets.json");
    await store.writeTextAtomic(filePath, "{\n  \"schemaVersion\": \"v2\"\n}\n");

    expect(store.readText(filePath)).toContain("\"schemaVersion\"");
  });

  it("reports exists/stat and missing paths", async () => {
    const filePath = path.join(dir, "fleet", "openclaw.json");
    expect(store.exists(filePath)).toBe(false);
    expect(store.stat(filePath)).toBeNull();

    await store.writeTextAtomic(filePath, "{}\n");
    expect(store.exists(filePath)).toBe(true);
    expect(store.stat(filePath)).toEqual({ isDirectory: false });
    expect(store.stat(path.dirname(filePath))).toEqual({ isDirectory: true });
    expect(store.readDir(path.dirname(filePath))).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "openclaw.json", isFile: true })]),
    );
  });

  it("rethrows non-missing stat errors", () => {
    const err = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const spy = vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw err;
    });
    expect(() => store.exists("/blocked")).toThrow(/permission denied/i);
    expect(() => store.stat("/blocked")).toThrow(/permission denied/i);
    spy.mockRestore();
  });
});
