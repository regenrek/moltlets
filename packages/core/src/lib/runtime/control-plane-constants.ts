export const HOST_STATUSES = ["online", "offline", "degraded", "unknown"] as const;
export const GATEWAY_STATUSES = HOST_STATUSES;
export const RUNNER_STATUSES = ["online", "offline"] as const;
export const SECRET_WIRING_SCOPES = ["bootstrap", "updates", "openclaw"] as const;
export const SECRET_WIRING_STATUSES = ["configured", "missing", "placeholder", "warn"] as const;
export const JOB_STATUSES = ["queued", "leased", "running", "succeeded", "failed", "canceled"] as const;

export const CONTROL_PLANE_TEXT_LIMITS = {
  hostName: 128,
  gatewayId: 128,
  secretName: 128,
  runnerName: 128,
  projectConfigPath: 512,
  hash: 128,
  jobKind: 128,
  leaseId: 128,
  payloadHash: 128,
  providerDisplayName: 128,
  errorMessage: 2000,
} as const;
