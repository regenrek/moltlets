import { beforeEach, describe, expect, it, vi } from "vitest";

const loadHostContextMock = vi.fn();
const sshRunMock = vi.fn();

vi.mock("@clawlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawlets/core/lib/ssh-remote", () => ({
  sshRun: sshRunMock,
  sshCapture: vi.fn(),
  shellQuote: (s: string) => s,
}));

const needsSudoMock = vi.fn(() => false);
const requireTargetHostMock = vi.fn((v: string) => v);
vi.mock("../src/commands/server/common.js", () => ({
  needsSudo: (v: string) => needsSudoMock(v),
  requireTargetHost: (v: string, hostName: string) => requireTargetHostMock(v, hostName),
}));

describe("server update apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts clawlets-update-fetch.service (no sudo)", async () => {
    loadHostContextMock.mockReturnValue({
      hostName: "alpha",
      hostCfg: { targetHost: "admin@host" },
    });

    const { serverUpdate } = await import("../src/commands/server/update.js");
    await (serverUpdate.subCommands as any).apply.run({
      args: { host: "alpha", sshTty: false },
    } as any);

    expect(sshRunMock).toHaveBeenCalledTimes(1);
    expect(sshRunMock.mock.calls[0]?.[0]).toBe("admin@host");
    expect(sshRunMock.mock.calls[0]?.[1]).toMatch(/systemctl start clawlets-update-fetch\.service/);
  });

  it("uses sudo when required", async () => {
    needsSudoMock.mockReturnValue(true);
    loadHostContextMock.mockReturnValue({
      hostName: "alpha",
      hostCfg: { targetHost: "admin@host" },
    });

    const { serverUpdate } = await import("../src/commands/server/update.js");
    await (serverUpdate.subCommands as any).apply.run({
      args: { host: "alpha", sshTty: false },
    } as any);

    expect(sshRunMock.mock.calls[0]?.[1]).toMatch(/sudo systemctl start clawlets-update-fetch\.service/);
  });
});

