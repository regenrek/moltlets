export function hasActiveLease(leaseExpiresAt: number | undefined, now: number): boolean {
  return typeof leaseExpiresAt === "number" && leaseExpiresAt > now;
}

export function normalizeRetentionDays(raw: number | undefined): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : 30;
  return Math.max(1, Math.min(365, Math.trunc(value)));
}
