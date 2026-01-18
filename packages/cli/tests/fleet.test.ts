import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultClawdletsConfig } from "@clawdlets/core/lib/clawdlets-config";

const findRepoRootMock = vi.hoisted(() => vi.fn());
vi.mock("@clawdlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

const loadClawdletsConfigMock = vi.hoisted(() => vi.fn());
const writeClawdletsConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@clawdlets/core/lib/clawdlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawdlets/core/lib/clawdlets-config")>("@clawdlets/core/lib/clawdlets-config");
  return {
    ...actual,
    loadClawdletsConfig: loadClawdletsConfigMock,
    writeClawdletsConfig: writeClawdletsConfigMock,
  };
});

describe("fleet set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRepoRootMock.mockReturnValue("/repo");
    const baseConfig = createDefaultClawdletsConfig({ host: "clawdbot-fleet-host", bots: [] });
    loadClawdletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawdlets.json", config: baseConfig });
  });

  it("sets guildId", async () => {
    const { fleet } = await import("../src/commands/fleet");
    await fleet.subCommands.set.run({ args: { "guild-id": "1234567890" } as any });
    expect(writeClawdletsConfigMock).toHaveBeenCalledTimes(1);
    const call = writeClawdletsConfigMock.mock.calls[0][0];
    expect(call.config.fleet.guildId).toBe("1234567890");
  });
});
