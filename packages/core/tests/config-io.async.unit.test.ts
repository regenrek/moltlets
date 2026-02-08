import { describe, it, expect } from "vitest";
import { createDefaultClawletsConfig } from "../src/lib/config/defaults";
import { loadInfraConfigAsync, writeClawletsConfig } from "../src/lib/config/io";
import type { ConfigStore, ConfigStoreStat } from "../src/lib/storage/config-store";

function makeMissingError(path: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

class AsyncMemoryConfigStore implements ConfigStore {
  private readonly files = new Map<string, string>();

  async readText(path: string): Promise<string> {
    const value = this.files.get(path);
    if (typeof value !== "string") throw makeMissingError(path);
    return value;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.hasDirectory(path);
  }

  async writeTextAtomic(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }

  async stat(path: string): Promise<ConfigStoreStat | null> {
    if (this.files.has(path)) return { isDirectory: false };
    if (this.hasDirectory(path)) return { isDirectory: true };
    return null;
  }

  private hasDirectory(path: string): boolean {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) return true;
    }
    return false;
  }
}

describe("config io async store", () => {
  it("writes split config files through async ConfigStore", async () => {
    const store = new AsyncMemoryConfigStore();
    const config = createDefaultClawletsConfig({ host: "alpha" });

    await writeClawletsConfig({
      configPath: "/repo/fleet/clawlets.json",
      config,
      store,
    });

    expect(await store.exists("/repo/fleet/clawlets.json")).toBe(true);
    expect(await store.exists("/repo/fleet/openclaw.json")).toBe(true);

    const loaded = await loadInfraConfigAsync({ repoRoot: "/repo", store });
    expect(loaded.config.defaultHost).toBe("alpha");
  });

  it("throws missing-config from async loader when config absent", async () => {
    const store = new AsyncMemoryConfigStore();
    await expect(loadInfraConfigAsync({ repoRoot: "/repo", store })).rejects.toThrow(/missing clawlets config/i);
  });
});
