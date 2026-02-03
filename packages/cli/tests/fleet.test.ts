import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultClawletsConfig } from "@clawlets/core/lib/clawlets-config";

const findRepoRootMock = vi.hoisted(() => vi.fn());
vi.mock("@clawlets/core/lib/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

const loadClawletsConfigMock = vi.hoisted(() => vi.fn());
const writeClawletsConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@clawlets/core/lib/clawlets-config", async () => {
  const actual = await vi.importActual<typeof import("@clawlets/core/lib/clawlets-config")>("@clawlets/core/lib/clawlets-config");
  return {
    ...actual,
    loadClawletsConfig: loadClawletsConfigMock,
    writeClawletsConfig: writeClawletsConfigMock,
  };
});

describe("fleet set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRepoRootMock.mockReturnValue("/repo");
    const baseConfig = createDefaultClawletsConfig({ host: "clawdbot-fleet-host", bots: [] });
    loadClawletsConfigMock.mockReturnValue({ configPath: "/repo/fleet/clawlets.json", config: baseConfig });
  });

  it("sets codex enable", async () => {
    const { fleet } = await import("../src/commands/fleet");
    await fleet.subCommands.set.run({ args: { "codex-enable": "true" } as any });
    expect(writeClawletsConfigMock).toHaveBeenCalledTimes(1);
    const call = writeClawletsConfigMock.mock.calls[0][0];
    expect(call.config.fleet.codex.enable).toBe(true);
  });
});
