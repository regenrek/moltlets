import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultClawletsConfig } from "@clawlets/core/lib/clawlets-config";

const findRepoRootMock = vi.hoisted(() => vi.fn());
vi.mock("@clawlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

const loadClawletsConfigRawMock = vi.hoisted(() => vi.fn());
const loadClawletsConfigMock = vi.hoisted(() => vi.fn());
const writeClawletsConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@clawlets/core/lib/clawlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/clawlets-config")>("@clawlets/core/lib/clawlets-config");
  return {
    ...actual,
    loadClawletsConfigRaw: loadClawletsConfigRawMock,
    loadClawletsConfig: loadClawletsConfigMock,
    writeClawletsConfig: writeClawletsConfigMock,
  };
});

describe("config set", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    findRepoRootMock.mockReturnValue("/repo");
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("init refuses overwrite without --force", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-config-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const configPath = path.join(repoRoot, "fleet", "clawlets.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{}", "utf8");
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.init.run({ args: { host: "alpha", force: false } } as any)).rejects.toThrow(
      /config already exists/i,
    );
  });

  it("init dry-run prints planned write", async () => {
    const repoRoot = fs.mkdtempSync(path.join(tmpdir(), "clawlets-config-"));
    findRepoRootMock.mockReturnValue(repoRoot);
    const { config } = await import("../src/commands/config");
    await config.subCommands.init.run({ args: { host: "alpha", "dry-run": true } } as any);
    expect(writeClawletsConfigMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/planned: write/i));
  });

  it("show prints JSON", async () => {
    const configObj = createDefaultClawletsConfig({ host: "alpha", bots: [] });
    loadClawletsConfigMock.mockReturnValue({ config: configObj });
    const { config } = await import("../src/commands/config");
    await config.subCommands.show.run({ args: { pretty: false } } as any);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(configObj));
  });

  it("validate prints ok", async () => {
    const configObj = createDefaultClawletsConfig({ host: "alpha", bots: [] });
    loadClawletsConfigMock.mockReturnValue({ config: configObj });
    const { config } = await import("../src/commands/config");
    await config.subCommands.validate.run({ args: {} } as any);
    expect(logSpy).toHaveBeenCalledWith("ok");
  });

  it("get prints JSON path output", async () => {
    const configObj = createDefaultClawletsConfig({ host: "alpha", bots: [] });
    loadClawletsConfigMock.mockReturnValue({ config: configObj });
    const { config } = await import("../src/commands/config");
    await config.subCommands.get.run({ args: { path: "defaultHost", json: true } } as any);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] || "{}"));
    expect(payload.path).toBe("defaultHost");
    expect(payload.value).toBe("alpha");
  });

  it("can fix an invalid config by applying a valid update", async () => {
    const baseConfig = createDefaultClawletsConfig({ host: "clawdbot-fleet-host", bots: [] });
    baseConfig.cattle.enabled = true;
    baseConfig.cattle.hetzner.image = "";
    loadClawletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawlets.json",
      config: baseConfig,
    });

    const { config } = await import("../src/commands/config");
    await config.subCommands.set.run({
      args: { path: "cattle.enabled", "value-json": "false" } as any,
    });

    expect(writeClawletsConfigMock).toHaveBeenCalledTimes(1);
    const call = writeClawletsConfigMock.mock.calls[0][0];
    expect(call.config.cattle.enabled).toBe(false);
  });

  it("set fails on invalid JSON", async () => {
    const baseConfig = createDefaultClawletsConfig({ host: "alpha", bots: [] });
    loadClawletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawlets.json",
      config: baseConfig,
    });
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.set.run({ args: { path: "hosts.alpha.botsOrder", "value-json": "nope" } } as any)).rejects.toThrow(
      /invalid --value-json/i,
    );
  });

  it("set rejects missing value flags", async () => {
    const baseConfig = createDefaultClawletsConfig({ host: "alpha", bots: [] });
    loadClawletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawlets.json",
      config: baseConfig,
    });
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.set.run({ args: { path: "hosts.alpha.botsOrder" } } as any)).rejects.toThrow(
      /set requires/i,
    );
  });

  it("set delete errors on missing path", async () => {
    const baseConfig = createDefaultClawletsConfig({ host: "alpha", bots: [] });
    loadClawletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawlets.json",
      config: baseConfig,
    });
    const { config } = await import("../src/commands/config");
    await expect(config.subCommands.set.run({ args: { path: "fleet.nope", delete: true } } as any)).rejects.toThrow(
      /path not found/i,
    );
  });
});
