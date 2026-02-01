import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const runMainMock = vi.fn();
const defineCommandMock = vi.fn((cmd) => cmd);
const readCliVersionMock = vi.fn(() => "0.0.0");
const findPluginByCommandMock = vi.fn();
const loadPluginCommandMock = vi.fn();

vi.mock("citty", () => ({
  runMain: runMainMock,
  defineCommand: defineCommandMock,
}));

vi.mock("../src/lib/version.js", () => ({
  readCliVersion: readCliVersionMock,
}));

vi.mock("../src/lib/plugins.js", () => ({
  findPluginByCommand: findPluginByCommandMock,
  loadPluginCommand: loadPluginCommandMock,
}));

describe("cli main", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalArgv = process.argv.slice();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.argv = originalArgv.slice();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    findPluginByCommandMock.mockReturnValue(null);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (exitSpy) exitSpy.mockRestore();
    process.argv = originalArgv.slice();
  });

  it("prints version and exits", async () => {
    process.argv = ["node", "clawlets", "--version"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      return undefined as never;
    }) as any);
    await import("../src/main.ts");
    expect(readCliVersionMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("0.0.0");
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(runMainMock).not.toHaveBeenCalled();
  });

  it("normalizes args and runs main", async () => {
    process.argv = ["node", "clawlets", "--", "doctor"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as any);
    await import("../src/main.ts");
    expect(runMainMock).toHaveBeenCalledTimes(1);
    expect(process.argv).toEqual(["node", "clawlets", "doctor"]);
  });

  it("dispatches plugins when flags precede the command", async () => {
    process.argv = ["node", "clawlets", "--runtime-dir", "/tmp/rt", "cattle", "--foo", "bar"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as any);
    findPluginByCommandMock.mockReturnValue({ command: "cattle" });
    loadPluginCommandMock.mockResolvedValue({ name: "plugin-command" });
    await import("../src/main.ts");
    expect(findPluginByCommandMock).toHaveBeenCalledWith({
      cwd: process.cwd(),
      runtimeDir: "/tmp/rt",
      command: "cattle",
    });
    expect(runMainMock).toHaveBeenCalledWith({ name: "plugin-command" }, { rawArgs: ["--foo", "bar"] });
  });
});
