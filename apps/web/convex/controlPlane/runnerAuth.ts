import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type RunnerTouchCtx = {
  runMutation: (...args: any[]) => Promise<unknown>;
};

const RUNNER_TOKEN_TOUCH_MIN_INTERVAL_MS = 5 * 60_000;

export async function touchRunnerTokenLastUsed(
  ctx: RunnerTouchCtx,
  params: { tokenId: Id<"runnerTokens">; now: number; minIntervalMs?: number },
): Promise<void> {
  try {
    await ctx.runMutation(internal.controlPlane.runnerTokens.touchLastUsedIfStaleInternal, {
      tokenId: params.tokenId,
      now: params.now,
      minIntervalMs: Math.max(0, Math.trunc(params.minIntervalMs ?? RUNNER_TOKEN_TOUCH_MIN_INTERVAL_MS)),
    });
  } catch {
    // best-effort write; auth should not fail due to touch telemetry.
  }
}
