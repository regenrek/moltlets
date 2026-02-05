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

describe("gateway command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("lists gateways", async () => {
    const config = makeConfig({
      hostOverrides: { gatewaysOrder: ["maren", "gunnar"], gateways: { maren: {}, gunnar: {} } },
    });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { gateway } = await import("../src/commands/openclaw/gateway.js");
    await gateway.subCommands?.list?.run?.({ args: {} } as any);
    expect(logSpy).toHaveBeenCalledWith("maren\ngunnar");
  });

  it("adds gateway and writes config", async () => {
    const config = makeConfig({ hostOverrides: { gatewaysOrder: ["maren"], gateways: { maren: {} } } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { gateway } = await import("../src/commands/openclaw/gateway.js");
    await gateway.subCommands?.add?.run?.({ args: { gateway: "gunnar", interactive: false } } as any);
    expect(writeClawletsConfigMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: added gateway gunnar (host=alpha)");
  });

  it("skips add when already present", async () => {
    const config = makeConfig({ hostOverrides: { gatewaysOrder: ["maren"], gateways: { maren: {} } } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { gateway } = await import("../src/commands/openclaw/gateway.js");
    await gateway.subCommands?.add?.run?.({ args: { gateway: "maren", interactive: false } } as any);
    expect(writeClawletsConfigMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: already present: maren (host=alpha)");
  });

  it("removes gateway", async () => {
    const config = makeConfig({ hostOverrides: { gatewaysOrder: ["maren"], gateways: { maren: {} } } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { gateway } = await import("../src/commands/openclaw/gateway.js");
    await gateway.subCommands?.rm?.run?.({ args: { gateway: "maren" } } as any);
    expect(writeClawletsConfigMock).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("ok: removed gateway maren (host=alpha)");
  });

  it("errors on interactive without TTY", async () => {
    const config = makeConfig({ hostOverrides: { gatewaysOrder: [], gateways: {} } });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    promptTextMock.mockResolvedValue("maren");
    const { gateway } = await import("../src/commands/openclaw/gateway.js");
    await expect(gateway.subCommands?.add?.run?.({ args: { gateway: "", interactive: true } } as any)).rejects.toThrow(
      /TTY/,
    );
    if (original) Object.defineProperty(process.stdout, "isTTY", original);
  });
});
