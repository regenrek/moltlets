import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeConfig, baseHost } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const sshCaptureMock = vi.fn();
const sshRunMock = vi.fn();
const shellQuoteMock = vi.fn((s: string) => s);

vi.mock("@clawlets/core/lib/runtime/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawlets/core/lib/security/ssh-remote", () => ({
  sshCapture: sshCaptureMock,
  sshRun: sshRunMock,
  shellQuote: shellQuoteMock,
}));

vi.mock("../src/commands/ssh-target.js", () => ({
  needsSudo: (targetHost: string) => !targetHost.startsWith("root@"),
  requireTargetHost: (v: string) => v,
}));

describe("server command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it("audit emits ok checks and json", async () => {
    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: { ...baseHost, tailnet: { mode: "tailscale" }, gatewaysOrder: ["maren"], gateways: { maren: {} } },
    });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ config, hostName: "alpha", hostCfg });

    sshCaptureMock.mockResolvedValue("ActiveState=active\nSubState=running\nLoadState=loaded\n");
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

    const { server } = await import("../src/commands/openclaw/server/index.js");
    await server.subCommands?.audit?.run?.({ args: { host: "alpha", targetHost: "admin@host", json: true } } as any);
    expect(logs.join("\n")).toMatch(/"checks"/);
    expect(process.exitCode).toBe(0);
    logSpy.mockRestore();
  });

  it("logs command normalizes unit and since", async () => {
    const config = makeConfig({ hostName: "alpha" });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg });
    const { server } = await import("../src/commands/openclaw/server/index.js");
    await server.subCommands?.logs?.run?.({
      args: {
        host: "alpha",
        targetHost: "admin@host",
        unit: "openclaw-maren",
        since: "5m",
        lines: "10",
      },
    } as any);
    const call = sshRunMock.mock.calls[0]?.[1] as string;
    expect(call).toContain("openclaw-maren.service");
    expect(call).toContain("5 min ago");
  });

  it("status runs systemctl list-units", async () => {
    const config = makeConfig({ hostName: "alpha" });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg });
    sshCaptureMock.mockResolvedValue("ok");
    const { server } = await import("../src/commands/openclaw/server/index.js");
    await server.subCommands?.status?.run?.({ args: { host: "alpha", targetHost: "admin@host" } } as any);
    expect(sshCaptureMock).toHaveBeenCalled();
  });

  it("tailscale-ipv4 parses and prints JSON output", async () => {
    const config = makeConfig({ hostName: "alpha" });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg });
    sshCaptureMock.mockResolvedValue("100.64.0.22\n");
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    const { server } = await import("../src/commands/openclaw/server/index.js");
    await server.subCommands?.["tailscale-ipv4"]?.run?.({ args: { host: "alpha", targetHost: "admin@host", json: true } } as any);
    expect(logs.join("\n")).toContain("\"ipv4\": \"100.64.0.22\"");
    logSpy.mockRestore();
  });

  it("ssh-check returns hostname in JSON mode", async () => {
    const config = makeConfig({ hostName: "alpha" });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ hostName: "alpha", hostCfg });
    sshCaptureMock.mockResolvedValue("alpha-node\n");
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));
    const { server } = await import("../src/commands/openclaw/server/index.js");
    await server.subCommands?.["ssh-check"]?.run?.({ args: { host: "alpha", targetHost: "admin@host", json: true } } as any);
    expect(logs.join("\n")).toContain("\"hostname\": \"alpha-node\"");
    logSpy.mockRestore();
  });
});
