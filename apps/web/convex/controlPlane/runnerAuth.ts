import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type RunnerTouchCtx = {
  runMutation: (...args: any[]) => Promise<unknown>;
};

export async function touchRunnerTokenLastUsed(
  ctx: RunnerTouchCtx,
  params: { tokenId: Id<"runnerTokens">; now: number },
): Promise<void> {
  try {
    await ctx.runMutation(internal.controlPlane.runnerTokens.touchLastUsedInternal, {
      tokenId: params.tokenId,
      now: params.now,
    });
  } catch {
    // best-effort write; auth should not fail due to touch telemetry.
  }
}
