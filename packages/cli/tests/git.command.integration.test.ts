import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMock = vi.fn();
const runMock = vi.fn();
const findRepoRootMock = vi.fn(() => "/repo");

vi.mock("@clawlets/core/lib/runtime/run", () => ({
  capture: captureMock,
  run: runMock,
}));

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

describe("git command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints status JSON for deploy metadata", async () => {
    captureMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") return "main\n";
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "local-head\n";
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && String(args[2] || "").includes("@{upstream}")) return "origin/main\n";
      if (args[0] === "rev-list") return "1 2\n";
      if (args[0] === "status") return "";
      if (args[0] === "for-each-ref") return "origin/main origin-head\n";
      return "";
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { git } = await import("../src/commands/git/index.js");
    await git.subCommands.status.run({ args: { json: true } } as any);

    const payloadRaw = String(logSpy.mock.calls[0]?.[0] || "{}");
    expect(JSON.parse(payloadRaw)).toEqual({
      branch: "main",
      upstream: "origin/main",
      localHead: "local-head",
      originDefaultRef: "origin/main",
      originHead: "origin-head",
      dirty: false,
      ahead: 2,
      behind: 1,
      detached: false,
      needsPush: true,
      canPush: true,
    });
    logSpy.mockRestore();
  });
});
