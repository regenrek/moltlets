import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fail } from "../shared/errors";
import { utf8ByteLength } from "../shared/controlPlane";

export const RUNNER_COMMAND_RESULT_TTL_MS = 5 * 60_000;
const RUNNER_COMMAND_RESULT_MAX_BYTES = 512 * 1024;

function normalizeRunnerCommandResultJson(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) fail("conflict", "commandResultJson required");
  if (utf8ByteLength(value) > RUNNER_COMMAND_RESULT_MAX_BYTES) fail("conflict", "commandResultJson too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("conflict", "commandResultJson must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("conflict", "commandResultJson must be a JSON object");
  }
  const normalized = JSON.stringify(parsed);
  if (!normalized || utf8ByteLength(normalized) > RUNNER_COMMAND_RESULT_MAX_BYTES) {
    fail("conflict", "commandResultJson too large");
  }
  return normalized;
}

export async function purgeExpiredRunnerCommandResults(
  ctx: MutationCtx,
  now: number,
  limit = 100,
): Promise<number> {
  const max = Math.max(1, Math.min(500, Math.trunc(limit)));
  const expired = await ctx.db
    .query("runnerCommandResults")
    .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
    .take(max);
  for (const row of expired) {
    await ctx.db.delete(row._id);
  }
  return expired.length;
}

export async function putRunnerCommandResult(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  jobId: Id<"jobs">;
  commandResultJson: string;
  now: number;
}): Promise<void> {
  const normalized = normalizeRunnerCommandResultJson(params.commandResultJson);
  const existing = await params.ctx.db
    .query("runnerCommandResults")
    .withIndex("by_job", (q) => q.eq("jobId", params.jobId))
    .collect();
  for (const row of existing) {
    await params.ctx.db.delete(row._id);
  }
  await params.ctx.db.insert("runnerCommandResults", {
    projectId: params.projectId,
    runId: params.runId,
    jobId: params.jobId,
    resultJson: normalized,
    createdAt: params.now,
    expiresAt: params.now + RUNNER_COMMAND_RESULT_TTL_MS,
  });
}
