import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";

const findRepoRootMock = vi.hoisted(() => vi.fn());
vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

const loadClawdletsConfigRawMock = vi.hoisted(() => vi.fn());
const writeClawdletsConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@clawdlets/core/lib/clawdlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdlets-config")>("@clawdlets/core/lib/clawdlets-config");
  return {
    ...actual,
    loadClawdletsConfigRaw: loadClawdletsConfigRawMock,
    writeClawdletsConfig: writeClawdletsConfigMock,
  };
});

describe("config set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRepoRootMock.mockReturnValue("/repo");
  });

  it("can fix an invalid config by applying a valid update", async () => {
    const baseConfig = createDefaultClawdletsConfig({ host: "clawdbot-fleet-host", bots: [] });
    baseConfig.cattle.enabled = true;
    baseConfig.cattle.hetzner.image = "";
    loadClawdletsConfigRawMock.mockReturnValue({
      configPath: "/repo/fleet/clawdlets.json",
      config: baseConfig,
    });

    const { config } = await import("../src/commands/config");
    await config.subCommands.set.run({
      args: { path: "cattle.enabled", "value-json": "false" } as any,
    });

    expect(writeClawdletsConfigMock).toHaveBeenCalledTimes(1);
    const call = writeClawdletsConfigMock.mock.calls[0][0];
    expect(call.config.cattle.enabled).toBe(false);
  });
});
