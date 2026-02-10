import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { fail } from "../shared/errors";
import { utf8ByteLength } from "../shared/controlPlane";

export const RUNNER_COMMAND_RESULT_BLOB_TTL_MS = 5 * 60_000;
export const RUNNER_COMMAND_RESULT_BLOB_MAX_BYTES = 5 * 1024 * 1024;

function normalizeRunnerCommandResultBlobJson(raw: string): { normalized: string; sizeBytes: number } {
  const value = String(raw || "").trim();
  if (!value) fail("conflict", "commandResultLargeJson required");
  const inputBytes = utf8ByteLength(value);
  if (inputBytes > RUNNER_COMMAND_RESULT_BLOB_MAX_BYTES) fail("conflict", "commandResultLargeJson too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("conflict", "commandResultLargeJson must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("conflict", "commandResultLargeJson must be a JSON object");
  }
  const normalized = JSON.stringify(parsed);
  const normalizedBytes = utf8ByteLength(normalized);
  if (!normalized || normalizedBytes > RUNNER_COMMAND_RESULT_BLOB_MAX_BYTES) {
    fail("conflict", "commandResultLargeJson too large");
  }
  return { normalized, sizeBytes: normalizedBytes };
}

export async function storeRunnerCommandResultBlob(params: {
  ctx: Pick<ActionCtx, "storage">;
  commandResultLargeJson: string;
}): Promise<{ storageId: Id<"_storage">; sizeBytes: number }> {
  const { normalized, sizeBytes } = normalizeRunnerCommandResultBlobJson(params.commandResultLargeJson);
  const storageId = (await params.ctx.storage.store(
    new Blob([normalized], { type: "application/json" }),
  )) as Id<"_storage">;
  return { storageId, sizeBytes };
}

export async function purgeExpiredRunnerCommandResultBlobs(
  ctx: MutationCtx,
  now: number,
  limit = 50,
): Promise<number> {
  const max = Math.max(1, Math.min(500, Math.trunc(limit)));
  const expired = await ctx.db
    .query("runnerCommandResultBlobs")
    .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
    .take(max);
  let deleted = 0;
  for (const row of expired) {
    try {
      await ctx.storage.delete(row.storageId);
    } catch {
      // best effort cleanup
    }
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return deleted;
}

export async function putRunnerCommandResultBlob(params: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  jobId: Id<"jobs">;
  storageId: Id<"_storage">;
  sizeBytes: number;
  now: number;
}): Promise<void> {
  if (!params.storageId) fail("conflict", "commandResultLargeStorageId required");
  if (!Number.isFinite(params.sizeBytes) || params.sizeBytes <= 0) {
    fail("conflict", "commandResultLargeSizeBytes invalid");
  }
  if (params.sizeBytes > RUNNER_COMMAND_RESULT_BLOB_MAX_BYTES) {
    fail("conflict", "commandResultLargeJson too large");
  }
  const existing = await params.ctx.db
    .query("runnerCommandResultBlobs")
    .withIndex("by_job", (q) => q.eq("jobId", params.jobId))
    .collect();
  for (const row of existing) {
    try {
      await params.ctx.storage.delete(row.storageId);
    } catch {
      // best effort cleanup
    }
    await params.ctx.db.delete(row._id);
  }
  await params.ctx.db.insert("runnerCommandResultBlobs", {
    projectId: params.projectId,
    runId: params.runId,
    jobId: params.jobId,
    storageId: params.storageId,
    sizeBytes: Math.trunc(params.sizeBytes),
    createdAt: params.now,
    expiresAt: params.now + RUNNER_COMMAND_RESULT_BLOB_TTL_MS,
  });
}
