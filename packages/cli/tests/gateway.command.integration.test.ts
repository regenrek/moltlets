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

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/config/clawlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/config/clawlets-config")>(
    "@clawlets/core/lib/config/clawlets-config",
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

  it("sets gateway memory backend/settings", async () => {
    const config = makeConfig({
      hostOverrides: {
        gatewaysOrder: ["maren"],
        gateways: {
          maren: {
            openclaw: {},
            agents: { defaults: {} },
          },
        },
      },
    });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config });
    const { gateway } = await import("../src/commands/openclaw/gateway.js");
    await gateway.subCommands?.set?.run?.({
      args: {
        gateway: "maren",
        backend: "qmd",
        "builtin-enabled": "true",
        "builtin-session-memory": "true",
        "builtin-max-results": "7",
        "builtin-min-score": "0.3",
        "qmd-command": "/run/current-system/sw/bin/qmd",
        "qmd-sessions-enabled": "true",
        "qmd-max-results": "9",
      },
    } as any);

    expect(writeClawletsConfigMock).toHaveBeenCalled();
    const written = writeClawletsConfigMock.mock.calls[0]?.[0]?.config;
    const gatewayCfg = written?.hosts?.alpha?.gateways?.maren as any;
    expect(gatewayCfg?.openclaw?.memory?.backend).toBe("qmd");
    expect(gatewayCfg?.openclaw?.memory?.qmd?.command).toBe("/run/current-system/sw/bin/qmd");
    expect(gatewayCfg?.openclaw?.memory?.qmd?.sessions?.enabled).toBe(true);
    expect(gatewayCfg?.openclaw?.memory?.qmd?.limits?.maxResults).toBe(9);
    expect(gatewayCfg?.agents?.defaults?.memorySearch?.enabled).toBe(true);
    expect(gatewayCfg?.agents?.defaults?.memorySearch?.experimental?.sessionMemory).toBe(true);
    expect(gatewayCfg?.agents?.defaults?.memorySearch?.query?.maxResults).toBe(7);
    expect(gatewayCfg?.agents?.defaults?.memorySearch?.query?.minScore).toBe(0.3);
    expect(logSpy).toHaveBeenCalledWith("ok: updated gateway maren (host=alpha)");
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
