import { RUN_KINDS } from "@clawlets/core/lib/runtime/run-constants";
import { JOB_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants";

export type JobStatus = (typeof JOB_STATUSES)[number];

const JOB_STATUS_SET = new Set<string>(JOB_STATUSES);

export function resolveRunKind(kind: string): (typeof RUN_KINDS)[number] {
  return (RUN_KINDS as readonly string[]).includes(kind) ? (kind as (typeof RUN_KINDS)[number]) : "custom";
}

function isKnownJobStatus(status: string): status is JobStatus {
  return JOB_STATUS_SET.has(status);
}

export function normalizeJobStatus(status: string | undefined): JobStatus {
  return typeof status === "string" && isKnownJobStatus(status) ? status : "failed";
}

export function isTerminalJobStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export function cancelJobPatch(now: number): {
  status: "canceled";
  finishedAt: number;
  payload: undefined;
  leaseId: undefined;
  leasedByRunnerId: undefined;
  leaseExpiresAt: undefined;
  errorMessage: undefined;
} {
  return {
    status: "canceled",
    finishedAt: now,
    payload: undefined,
    leaseId: undefined,
    leasedByRunnerId: undefined,
    leaseExpiresAt: undefined,
    errorMessage: undefined,
  };
}

export function cancelRunPatch(now: number): {
  status: "canceled";
  finishedAt: number;
  errorMessage: undefined;
} {
  return {
    status: "canceled",
    finishedAt: now,
    errorMessage: undefined,
  };
}

export function canCompleteJob(params: {
  job:
    | {
        leaseId?: string;
        status: string;
        leaseExpiresAt?: number;
      }
    | null;
  leaseId: string;
  now: number;
}): { ok: boolean; status: JobStatus } {
  const job = params.job;
  if (!job) return { ok: false, status: "failed" };
  const status = normalizeJobStatus(job.status);
  if (job.leaseId !== params.leaseId) return { ok: false, status };
  if (status !== "leased" && status !== "running") return { ok: false, status };
  // Lease expiry is enforced by lease-next stale sweeps. For heartbeat/complete,
  // accept an expired lease when leaseId still matches to tolerate transient
  // control-plane network blips without re-running already finished jobs.
  if (typeof job.leaseExpiresAt !== "number") {
    return { ok: false, status };
  }
  return { ok: true, status };
}
