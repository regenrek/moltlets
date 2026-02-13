export const RUNNER_LEASE_WAIT_MS_MIN = 0;
export const RUNNER_LEASE_WAIT_MS_MAX = 60_000;
export const RUNNER_LEASE_WAIT_POLL_MS_DEFAULT = 8_000;
export const RUNNER_LEASE_WAIT_POLL_MS_MIN = 2_000;
export const RUNNER_LEASE_WAIT_POLL_MS_MAX = 15_000;

function toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function normalizeRunnerLeaseWaitOptions(params: {
  waitMsRaw: unknown;
  waitPollMsRaw: unknown;
  nowMs?: number;
}): {
  waitMs: number;
  waitPollMs: number;
  waitApplied: boolean;
  deadlineMs: number;
} {
  const waitMs = toBoundedInt(
    params.waitMsRaw,
    0,
    RUNNER_LEASE_WAIT_MS_MIN,
    RUNNER_LEASE_WAIT_MS_MAX,
  );
  const waitPollMs = toBoundedInt(
    params.waitPollMsRaw,
    RUNNER_LEASE_WAIT_POLL_MS_DEFAULT,
    RUNNER_LEASE_WAIT_POLL_MS_MIN,
    RUNNER_LEASE_WAIT_POLL_MS_MAX,
  );
  const nowMs =
    typeof params.nowMs === "number" && Number.isFinite(params.nowMs)
      ? Math.trunc(params.nowMs)
      : Date.now();
  return {
    waitMs,
    waitPollMs,
    waitApplied: waitMs > 0,
    deadlineMs: nowMs + waitMs,
  };
}

export async function runLeaseNextWithWait<T>(params: {
  leaseNext: () => Promise<T | null>;
  waitMsRaw: unknown;
  waitPollMsRaw: unknown;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ job: T | null; waitApplied: boolean }> {
  const now = params.now ?? Date.now;
  const wait = normalizeRunnerLeaseWaitOptions({
    waitMsRaw: params.waitMsRaw,
    waitPollMsRaw: params.waitPollMsRaw,
    nowMs: now(),
  });
  while (true) {
    const job = await params.leaseNext();
    if (job) return { job, waitApplied: wait.waitApplied };
    if (!wait.waitApplied) return { job: null, waitApplied: false };
    const remainingMs = wait.deadlineMs - now();
    if (remainingMs <= 0) return { job: null, waitApplied: true };
    await params.sleep(Math.min(wait.waitPollMs, remainingMs));
  }
}
