type RunnerStatus = "online" | "offline";
type JobStatus = "sealed_pending" | "queued" | "leased" | "running" | "succeeded" | "failed" | "canceled";
type SecretScope = "bootstrap" | "updates" | "openclaw" | "all";
type SecretStatus = "configured" | "missing" | "placeholder" | "warn";
type RunnerHttpErrorKind = "auth" | "permanent" | "transient" | "malformed";

export type RunnerLeaseJob = {
  jobId: string;
  runId: string;
  leaseId: string;
  leaseExpiresAt: number;
  kind: string;
  targetRunnerId?: string;
  sealedInputB64?: string;
  sealedInputAlg?: string;
  sealedInputKeyId?: string;
  sealedInputRequired?: boolean;
  payloadMeta?: {
    hostName?: string;
    gatewayId?: string;
    scope?: SecretScope;
    secretNames?: string[];
    updatedKeys?: string[];
    sealedInputKeys?: string[];
    configPaths?: string[];
    args?: string[];
    note?: string;
    repoUrl?: string;
    branch?: string;
    depth?: number;
    templateRepo?: string;
    templatePath?: string;
    templateRef?: string;
  };
  attempt: number;
};

export type RunnerProjectTokenKeyringSummary = {
  hasActive: boolean;
  itemCount: number;
  items: Array<{
    id: string;
    label: string;
    maskedValue: string;
    isActive: boolean;
  }>;
};

export type RunnerSshListSummary = {
  count: number;
  items: string[];
};

export type RunnerDeployCredsSummary = {
  updatedAtMs: number;
  envFileOrigin?: "default" | "explicit";
  envFileStatus?: "ok" | "missing" | "invalid";
  envFileError?: string;
  hasGithubToken: boolean;
  sopsAgeKeyFileSet: boolean;
  projectTokenKeyrings: {
    hcloud: RunnerProjectTokenKeyringSummary;
    tailscale: RunnerProjectTokenKeyringSummary;
  };
  fleetSshAuthorizedKeys: RunnerSshListSummary;
  fleetSshKnownHosts: RunnerSshListSummary;
};

export type RunnerMetadataSyncPayload = {
  projectConfigs: Array<{ path: string; type: "fleet" | "host" | "gateway" | "provider" | "raw"; sha256?: string; error?: string }>;
  hosts: Array<{
    hostName: string;
    patch: {
      provider?: string;
      region?: string;
      lastSeenAt?: number;
      lastStatus?: "online" | "offline" | "degraded" | "unknown";
      lastRunId?: string;
      lastRunStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled";
      desired?: {
        enabled?: boolean;
        provider?: string;
        region?: string;
        gatewayCount?: number;
        gatewayArchitecture?: string;
        updateRing?: string;
        theme?: string;
        sshExposureMode?: string;
        targetHost?: string;
        tailnetMode?: string;
        selfUpdateEnabled?: boolean;
        selfUpdateChannel?: string;
        selfUpdateBaseUrlCount?: number;
        selfUpdatePublicKeyCount?: number;
        selfUpdateAllowUnsigned?: boolean;
      };
    };
  }>;
  gateways: Array<{
    hostName: string;
    gatewayId: string;
    patch: {
      lastSeenAt?: number;
      lastStatus?: "online" | "offline" | "degraded" | "unknown";
      desired?: {
        enabled?: boolean;
        channelCount?: number;
        personaCount?: number;
        provider?: string;
        channels?: string[];
        personaIds?: string[];
        port?: number;
      };
    };
  }>;
  secretWiring: Array<{
    hostName: string;
    secretName: string;
    scope: SecretScope;
    status: SecretStatus;
    required: boolean;
    lastVerifiedAt?: number;
  }>;
  deployCredsSummary?: RunnerDeployCredsSummary;
};

function trimBase(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function parseJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

function classifyHttpStatus(status: number): RunnerHttpErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "transient";
  if (status >= 500) return "transient";
  return "permanent";
}

export class RunnerHttpError extends Error {
  readonly kind: RunnerHttpErrorKind;
  readonly path: string;
  readonly status?: number;

  constructor(params: {
    kind: RunnerHttpErrorKind;
    path: string;
    message: string;
    status?: number;
  }) {
    super(params.message);
    this.name = "RunnerHttpError";
    this.kind = params.kind;
    this.path = params.path;
    this.status = params.status;
  }
}

export function classifyRunnerHttpError(error: unknown): RunnerHttpErrorKind | "unknown" {
  return error instanceof RunnerHttpError ? error.kind : "unknown";
}

async function readJsonObjectOrThrow(response: Response, path: string): Promise<Record<string, unknown>> {
  const raw = await response.text();
  const text = raw.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RunnerHttpError({
        kind: "malformed",
        path,
        message: `${path} failed: malformed JSON response`,
      });
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof RunnerHttpError) throw err;
    throw new RunnerHttpError({
      kind: "malformed",
      path,
      message: `${path} failed: malformed JSON response`,
    });
  }
}

export class RunnerApiClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, token: string, timeoutMs = 15_000) {
    this.baseUrl = trimBase(baseUrl);
    this.token = String(token || "").trim();
    this.timeoutMs = Math.max(1_000, Math.min(120_000, Math.trunc(timeoutMs)));
    if (!this.baseUrl) throw new Error("control plane url required");
    if (!this.token) throw new Error("runner token required");
  }

  private async post<T>(path: string, body: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const requestTimeoutMs = Math.max(1_000, Math.min(120_000, Math.trunc(timeoutMs)));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new RunnerHttpError({
          kind: "transient",
          path,
          message: `${path} failed: request timed out after ${requestTimeoutMs}ms`,
        });
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new RunnerHttpError({
        kind: "transient",
        path,
        message: `${path} failed: network error: ${detail}`,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const data = await parseJson(response);
      const reason = data?.error ? String(data.error) : `http ${response.status}`;
      throw new RunnerHttpError({
        kind: classifyHttpStatus(response.status),
        path,
        status: response.status,
        message: `${path} failed: ${reason}`,
      });
    }
    return (await readJsonObjectOrThrow(response, path)) as T;
  }

  async heartbeat(params: {
    projectId: string;
    runnerName: string;
    version?: string;
    capabilities?: {
      supportsSealedInput?: boolean;
      sealedInputAlg?: string;
      sealedInputPubSpkiB64?: string;
      sealedInputKeyId?: string;
      supportsInfraApply?: boolean;
      hasNix?: boolean;
      nixBin?: string;
      nixVersion?: string;
    };
    status?: RunnerStatus;
  }): Promise<{ ok: boolean; runnerId: string }> {
    return await this.post("/runner/heartbeat", params);
  }

  async leaseNext(params: {
    projectId: string;
    leaseTtlMs?: number;
    waitMs?: number;
    waitPollMs?: number;
  }): Promise<{ job: RunnerLeaseJob | null; waitApplied?: boolean }> {
    const waitMs =
      typeof params.waitMs === "number" && Number.isFinite(params.waitMs) ? Math.max(0, Math.trunc(params.waitMs)) : 0;
    const waitPollMs =
      typeof params.waitPollMs === "number" && Number.isFinite(params.waitPollMs) ? Math.max(0, Math.trunc(params.waitPollMs)) : undefined;
    const timeoutMs = waitMs > 0 ? this.timeoutMs + waitMs + 5_000 : this.timeoutMs;
    return await this.post(
      "/runner/jobs/lease-next",
      {
        projectId: params.projectId,
        ...(typeof params.leaseTtlMs === "number" && Number.isFinite(params.leaseTtlMs)
          ? { leaseTtlMs: Math.trunc(params.leaseTtlMs) }
          : {}),
        ...(typeof params.waitMs !== "undefined" || typeof params.waitPollMs !== "undefined"
          ? { waitMs }
          : {}),
        ...(typeof waitPollMs === "number" ? { waitPollMs } : {}),
      },
      timeoutMs,
    );
  }

  async heartbeatJob(params: { projectId: string; jobId: string; leaseId: string; leaseTtlMs?: number }): Promise<{ ok: boolean; status: JobStatus }> {
    return await this.post("/runner/jobs/heartbeat", params);
  }

  async completeJob(params: {
    projectId: string;
    jobId: string;
    leaseId: string;
    status: "succeeded" | "failed" | "canceled";
    errorMessage?: string;
    commandResultJson?: string;
    commandResultLargeJson?: string;
  }): Promise<{ ok: boolean }> {
    return await this.post("/runner/jobs/complete", params);
  }

  async appendRunEvents(params: {
    projectId: string;
    runId: string;
    events: Array<{
      ts: number;
      level: "debug" | "info" | "warn" | "error";
      message: string;
      meta?: { kind: "phase"; phase: "command_start" | "command_end" | "post_run_cleanup" | "truncated" } | { kind: "exit"; code: number };
      redacted?: boolean;
    }>;
  }): Promise<{ ok: boolean }> {
    return await this.post("/runner/run-events/append-batch", params);
  }

  async syncMetadata(params: { projectId: string; payload: RunnerMetadataSyncPayload }): Promise<{ ok: boolean }> {
    return await this.post("/runner/metadata/sync", {
      projectId: params.projectId,
      projectConfigs: params.payload.projectConfigs,
      hosts: params.payload.hosts,
      gateways: params.payload.gateways,
      secretWiring: params.payload.secretWiring,
      ...(params.payload.deployCredsSummary ? { deployCredsSummary: params.payload.deployCredsSummary } : {}),
    });
  }
}
