import { describe, expect, it, vi } from "vitest";
import { touchRunnerTokenLastUsed } from "../convex/controlPlane/runnerAuth";

describe("runner token last-used touch", () => {
  it("awaits mutation completion before resolving", async () => {
    let resolveMutation: (() => void) | undefined;
    const runMutation = vi.fn(
      async (_mutation: unknown, _args: unknown) =>
        await new Promise<null>((resolve) => {
          resolveMutation = () => resolve(null);
        }),
    );
    let settled = false;
    const touchPromise = touchRunnerTokenLastUsed(
      { runMutation },
      { tokenId: "token_1" as any, now: 123 },
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      tokenId: "token_1",
      now: 123,
      minIntervalMs: 300_000,
    });
    expect(settled).toBe(false);

    resolveMutation?.();
    await touchPromise;
    expect(settled).toBe(true);
  });

  it("swallows mutation errors", async () => {
    const runMutation = vi.fn(async () => {
      throw new Error("db unavailable");
    });

    await expect(
      touchRunnerTokenLastUsed({ runMutation }, { tokenId: "token_1" as any, now: 123 }),
    ).resolves.toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("passes explicit minIntervalMs when provided", async () => {
    const runMutation = vi.fn(async (_mutation: unknown, _args: unknown) => null);
    await touchRunnerTokenLastUsed(
      { runMutation },
      { tokenId: "token_1" as any, now: 123, minIntervalMs: 42_000 },
    );
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      tokenId: "token_1",
      now: 123,
      minIntervalMs: 42_000,
    });
  });
});
