import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { makeConfig } from "./fixtures.js";

const findRepoRootMock = vi.fn(() => "/repo");
const loadClawletsConfigMock = vi.fn();
const writeClawletsConfigMock = vi.fn();
const promptTextMock = vi.fn();

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  text: promptTextMock,
  isCancel: () => false,
}));

vi.mock("@clawlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/clawlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/clawlets-config")>(
    "@clawlets/core/lib/clawlets-config",
  );
  return {
    ...actual,
    loadClawletsConfig: loadClawletsConfigMock,
    writeClawletsConfig: writeClawletsConfigMock,
  };
});

describe("bot command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("lists bots", async () => {
    const config = makeConfig({ fleetOverrides: { botOrder: ["maren", "gunnar"], bots: { maren: {}, gunnar: {} } } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { bot } = await import("../src/commands/bot.js");
    await bot.subCommands?.list?.run?.({ args: {} } as any);
    expect(logSpy).toHaveBeenCalledWith("maren\ngunnar");
  });

  it("adds bot and writes config", async () => {
    const config = makeConfig({ fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { bot } = await import("../src/commands/bot.js");
    await bot.subCommands?.add?.run?.({ args: { bot: "gunnar", interactive: false } } as any);
    expect(writeClawletsConfigMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: added bot gunnar");
  });

  it("skips add when already present", async () => {
    const config = makeConfig({ fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { bot } = await import("../src/commands/bot.js");
    await bot.subCommands?.add?.run?.({ args: { bot: "maren", interactive: false } } as any);
    expect(writeClawletsConfigMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: already present: maren");
  });

  it("removes bot", async () => {
    const config = makeConfig({ fleetOverrides: { botOrder: ["maren"], bots: { maren: {} } } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { bot } = await import("../src/commands/bot.js");
    await bot.subCommands?.rm?.run?.({ args: { bot: "maren" } } as any);
    expect(writeClawletsConfigMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: removed bot maren");
  });

  it("errors on interactive without TTY", async () => {
    const config = makeConfig({ fleetOverrides: { botOrder: [], bots: {} } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    promptTextMock.mockResolvedValue("maren");
    const { bot } = await import("../src/commands/bot.js");
    await expect(bot.subCommands?.add?.run?.({ args: { bot: "", interactive: true } } as any)).rejects.toThrow(/TTY/);
    if (original) Object.defineProperty(process.stdout, "isTTY", original);
  });
});
