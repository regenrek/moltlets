import { beforeEach, describe, expect, it, vi } from "vitest";

const compareOpenclawSchemaToNixOpenclawMock = vi.fn();
const summarizeOpenclawSchemaComparisonMock = vi.fn();
const findRepoRootMock = vi.fn(() => "/repo");

vi.mock("@clawlets/core/lib/project/repo", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("@clawlets/core/lib/openclaw/schema/compare", () => ({
  compareOpenclawSchemaToNixOpenclaw: compareOpenclawSchemaToNixOpenclawMock,
  summarizeOpenclawSchemaComparison: summarizeOpenclawSchemaComparisonMock,
}));

vi.mock("@clawlets/core/lib/nix/nix-openclaw-source", () => ({
  fetchNixOpenclawSourceInfo: vi.fn(),
  getNixOpenclawRevFromFlakeLock: vi.fn(),
}));

describe("openclaw schema command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints JSON schema status", async () => {
    compareOpenclawSchemaToNixOpenclawMock.mockResolvedValue({ any: true });
    summarizeOpenclawSchemaComparisonMock.mockReturnValue({
      pinned: { ok: true, nixOpenclawRev: "nix-rev", openclawRev: "openclaw-pin" },
      upstream: { ok: true, nixOpenclawRef: "main", openclawRev: "openclaw-main" },
      warnings: ["warning-a"],
    });

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));

    const { openclawSchema } = await import("../src/commands/openclaw/schema.js");
    await openclawSchema.subCommands?.status?.run?.({ args: { json: true } } as any);

    expect(compareOpenclawSchemaToNixOpenclawMock).toHaveBeenCalledTimes(1);
    expect(findRepoRootMock).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      ok: true,
      pinned: { nixOpenclawRev: "nix-rev", openclawRev: "openclaw-pin" },
      upstream: { nixOpenclawRef: "main", openclawRev: "openclaw-main" },
      warnings: ["warning-a"],
    });

    logSpy.mockRestore();
  });

  it("prints unavailable summary when comparison is missing", async () => {
    compareOpenclawSchemaToNixOpenclawMock.mockResolvedValue(null);

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));

    const { openclawSchema } = await import("../src/commands/openclaw/schema.js");
    await openclawSchema.subCommands?.status?.run?.({ args: { json: false } } as any);

    expect(lines.join("\n")).toContain("pinned: unavailable");
    expect(lines.join("\n")).toContain("upstream: unavailable");
    expect(lines.join("\n")).toContain("warn: openclaw schema revision unavailable");

    logSpy.mockRestore();
  });
});
