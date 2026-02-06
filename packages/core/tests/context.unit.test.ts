import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeConfig } from "./fixtures.js";

const findRepoRootMock = vi.fn(() => "/repo");
const loadClawletsConfigMock = vi.fn();
const resolveHostNameOrExitMock = vi.fn();

vi.mock("../src/lib/project/repo.js", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("../src/lib/config/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/config/index.js")>(
    "../src/lib/config/index.js",
  );
  return {
    ...actual,
    loadClawletsConfig: loadClawletsConfigMock,
  };
});

vi.mock("../src/lib/host/host-resolve.js", () => ({
  resolveHostNameOrExit: resolveHostNameOrExitMock,
}));

describe("context helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loadRepoContext returns repoRoot/layout/config", async () => {
    const config = makeConfig();
    loadClawletsConfigMock.mockReturnValue({ layout: { repoRoot: "/repo" }, config });
    const { loadRepoContext } = await import("../src/lib/runtime/context.js");
    const ctx = loadRepoContext({ cwd: "/repo" });
    expect(ctx.repoRoot).toBe("/repo");
    expect(ctx.config).toBe(config);
    expect(ctx.layout.repoRoot).toBe("/repo");
  });

  it("loadHostContextOrExit returns null when host resolve fails", async () => {
    resolveHostNameOrExitMock.mockReturnValue(null);
    const { loadHostContextOrExit } = await import("../src/lib/runtime/context.js");
    const ctx = loadHostContextOrExit({ cwd: "/repo", hostArg: "" });
    expect(ctx).toBeNull();
  });

  it("loadHostContextOrExit throws when host missing in config", async () => {
    const config = makeConfig({ hostName: "alpha" });
    loadClawletsConfigMock.mockReturnValue({ layout: { repoRoot: "/repo" }, config });
    resolveHostNameOrExitMock.mockReturnValue("missing");
    const { loadHostContextOrExit } = await import("../src/lib/runtime/context.js");
    expect(() => loadHostContextOrExit({ cwd: "/repo", hostArg: "missing" })).toThrow(/missing host/i);
  });
});
