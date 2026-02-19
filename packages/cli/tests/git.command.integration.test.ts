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

  it("setup-save rejects non-setup changes", async () => {
    captureMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "diff" && args[1] === "--name-only" && args[2] === "-z") return "README.md\0";
      if (args[0] === "diff" && args[1] === "--cached" && args[2] === "--name-only" && args[3] === "-z") return "";
      if (args[0] === "ls-files") return "";
      return "";
    });

    const { git } = await import("../src/commands/git/index.js");
    await expect(
      (git.subCommands as any)["setup-save"].run({ args: { host: "alpha", json: true } } as any),
    ).rejects.toThrow(/non-setup modifications/i);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("setup-save stages, commits, and pushes setup-owned changes", async () => {
    let staged = false;
    runMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "add") staged = true;
      return undefined;
    });

    captureMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === "diff" && args[1] === "--name-only" && args[2] === "-z") {
        return "fleet/clawlets.json\0secrets/hosts/alpha/admin_password_hash.yaml\0";
      }
      if (args[0] === "diff" && args[1] === "--cached" && args[2] === "--name-only" && args[3] === "-z") {
        return staged ? "fleet/clawlets.json\0secrets/hosts/alpha/admin_password_hash.yaml\0" : "";
      }
      if (args[0] === "ls-files") return "";
      if (args[0] === "symbolic-ref") return "main\n";
      if (
        args[0] === "for-each-ref"
        && args[1] === "--format"
        && args[2] === "%(objectname)"
        && args[3] === "refs/heads/main"
      ) return "local-head\n";
      if (
        args[0] === "for-each-ref"
        && args[1] === "--format"
        && args[2] === "%(upstream:short)"
        && args[3] === "refs/heads/main"
      ) return "origin/main\n";
      if (args[0] === "rev-list") return "0 1\n";
      if (args[0] === "status" && args[1] === "--porcelain") return "";
      if (
        args[0] === "for-each-ref"
        && args[1] === "--format"
        && args[2] === "%(refname:short) %(objectname)"
        && args[3] === "refs/remotes/origin/HEAD"
      ) return "origin/main origin-head\n";
      if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD") return "new-sha\n";
      return "";
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { git } = await import("../src/commands/git/index.js");
    await (git.subCommands as any)["setup-save"].run({ args: { host: "alpha", json: true } } as any);

    const payloadRaw = String(logSpy.mock.calls[0]?.[0] || "{}");
    expect(JSON.parse(payloadRaw)).toMatchObject({
      ok: true,
      host: "alpha",
      branch: "main",
      sha: "new-sha",
      committed: true,
      pushed: true,
      changedPaths: [
        "fleet/clawlets.json",
        "secrets/hosts/alpha/admin_password_hash.yaml",
      ],
    });
    expect(runMock).toHaveBeenCalledWith("git", ["add", "-A", "--", "fleet", "secrets"], expect.anything());
    expect(runMock).toHaveBeenCalledWith("git", ["commit", "-m", "chore(setup): save alpha [skip ci]"], expect.anything());
    expect(runMock).toHaveBeenCalledWith("git", ["push"], expect.anything());
    logSpy.mockRestore();
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
