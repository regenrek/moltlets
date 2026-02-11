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

  it("does not expose a clone subcommand", async () => {
    const { git } = await import("../src/commands/git/index.js");
    expect((git as any).subCommands?.clone).toBeUndefined();
  });

  it("prints status JSON for deploy metadata", async () => {
    captureMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "symbolic-ref") return "main\n";
      if (args[0] === "for-each-ref" && args[1] === "--format" && args[2] === "%(objectname)" && args[3] === "refs/heads/main") return "local-head\n";
      if (args[0] === "for-each-ref" && args[1] === "--format" && args[2] === "%(upstream:short)" && args[3] === "refs/heads/main") return "origin/main\n";
      if (args[0] === "rev-list") return "1 2\n";
      if (args[0] === "status") return "";
      if (args[0] === "for-each-ref" && args[1] === "--format" && args[2] === "%(refname:short) %(objectname)" && args[3] === "refs/remotes/origin/HEAD") {
        return "origin/main origin-head\n";
      }
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

  it("handles unborn HEAD without throwing and reports missing commit state", async () => {
    captureMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "symbolic-ref") return "main\n";
      if (args[0] === "for-each-ref" && args[1] === "--format" && args[2] === "%(objectname)" && args[3] === "refs/heads/main") return "";
      if (args[0] === "for-each-ref" && args[1] === "--format" && args[2] === "%(upstream:short)" && args[3] === "refs/heads/main") return "";
      if (args[0] === "status") return "";
      if (args[0] === "for-each-ref" && args[1] === "--format" && args[2] === "%(refname:short) %(objectname)" && args[3] === "refs/remotes/origin/HEAD") {
        return "";
      }
      if (args[0] === "config" && args[1] === "--get" && args[2] === "remote.origin.url") return "git@github.com:example/repo.git\n";
      return "";
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { git } = await import("../src/commands/git/index.js");
    await git.subCommands.status.run({ args: { json: true } } as any);

    const payloadRaw = String(logSpy.mock.calls[0]?.[0] || "{}");
    expect(JSON.parse(payloadRaw)).toEqual({
      branch: "main",
      upstream: null,
      localHead: null,
      originDefaultRef: null,
      originHead: null,
      dirty: false,
      ahead: null,
      behind: null,
      detached: false,
      needsPush: false,
      canPush: false,
      pushBlockedReason: "No commits yet. Create the first commit before pushing.",
    });
    logSpy.mockRestore();
  });
});
