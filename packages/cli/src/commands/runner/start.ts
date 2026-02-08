import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomBytes, randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import { capture, run } from "@clawlets/core/lib/runtime/run";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error";
import { classifyRunnerHttpError, RunnerApiClient, type RunnerLeaseJob } from "./client.js";
import { buildMetadataSnapshot } from "./metadata.js";
import { LocalSecretsBuffer } from "./secrets-local.js";

function envName(): string {
  const raw = String(process.env["USER"] || process.env["USERNAME"] || "runner").trim();
  return raw || "runner";
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeBaseUrl(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveControlPlaneUrl(raw: unknown): string {
  const arg = String(raw || "").trim();
  if (arg) return normalizeBaseUrl(arg);
  const env =
    String(process.env["CLAWLETS_CONTROL_PLANE_URL"] || "").trim() ||
    String(process.env["CONVEX_SITE_URL"] || "").trim();
  if (!env) {
    throw new Error("missing control-plane url (--control-plane-url or CLAWLETS_CONTROL_PLANE_URL)");
  }
  return normalizeBaseUrl(env);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeSecretsJsonTemp(jobId: string, values: Record<string, string>): Promise<string> {
  const adminPasswordHash = String(values["adminPasswordHash"] || "").trim();
  const tailscaleAuthKey = String(values["tailscaleAuthKey"] || "").trim();
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "adminPasswordHash" || key === "tailscaleAuthKey") continue;
    const name = key.trim();
    if (!name) continue;
    secrets[name] = value;
  }
  const body = {
    adminPasswordHash,
    ...(tailscaleAuthKey ? { tailscaleAuthKey } : {}),
    secrets,
  };
  const filePath = path.join(os.tmpdir(), `clawlets-runner-secrets.${jobId}.${process.pid}.${randomUUID()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return filePath;
}

async function writeInputJsonTemp(jobId: string, values: Record<string, string>): Promise<string> {
  const filePath = path.join(os.tmpdir(), `clawlets-runner-input.${jobId}.${process.pid}.${randomUUID()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return filePath;
}

function defaultArgsForJob(job: RunnerLeaseJob): string[] {
  const host = job.payloadMeta?.hostName ? ["--host", job.payloadMeta.hostName] : [];
  const scope = job.payloadMeta?.scope ? ["--scope", job.payloadMeta.scope] : [];
  switch (job.kind) {
    case "doctor":
      return ["doctor", ...host];
    case "bootstrap":
      return ["bootstrap", ...host];
    case "lockdown":
      return ["lockdown", ...host];
    case "secrets_verify":
    case "secrets_verify_bootstrap":
    case "secrets_verify_openclaw":
      return ["secrets", "verify", ...host, ...scope];
    case "secrets_sync":
      return ["secrets", "sync", ...host];
    case "secrets_init":
      return ["secrets", "init", ...host, ...scope];
    case "server_channels":
    case "server_status":
    case "server_logs":
    case "server_audit":
    case "server_restart":
    case "server_update_apply":
    case "server_update_status":
    case "server_update_logs":
    case "git_push":
      throw new Error(`job ${job.kind} requires payloadMeta.args`);
    default:
      throw new Error(`unsupported job kind: ${job.kind}`);
  }
}

export function __test_defaultArgsForJob(job: RunnerLeaseJob): string[] {
  return defaultArgsForJob(job);
}

function createLocalSecretsNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function __test_createLocalSecretsNonce(): string {
  return createLocalSecretsNonce();
}

function shouldStopOnCompletionError(kind: ReturnType<typeof classifyRunnerHttpError>): boolean {
  return kind === "auth" || kind === "permanent";
}

export function __test_shouldStopOnCompletionError(kind: ReturnType<typeof classifyRunnerHttpError>): boolean {
  return shouldStopOnCompletionError(kind);
}

export async function __test_writeSecretsJsonTemp(jobId: string, values: Record<string, string>): Promise<string> {
  return await writeSecretsJsonTemp(jobId, values);
}

export async function __test_writeInputJsonTemp(jobId: string, values: Record<string, string>): Promise<string> {
  return await writeInputJsonTemp(jobId, values);
}

async function executeJob(params: {
  job: RunnerLeaseJob;
  repoRoot: string;
  secrets: LocalSecretsBuffer;
  allowPrompt: boolean;
  secretsWaitMs: number;
}): Promise<{ output?: string }> {
  const entry = process.argv[1];
  if (!entry) throw new Error("unable to resolve cli entry path");
  const args = [...(params.job.payloadMeta?.args ?? defaultArgsForJob(params.job))];
  if (args.length === 0) throw new Error("job args empty");

  const secretsPlaceholderIdx = args.findIndex((value) => value === "__RUNNER_SECRETS_JSON__");
  const inputPlaceholderIdx = args.findIndex((value) => value === "__RUNNER_INPUT_JSON__");
  if (secretsPlaceholderIdx >= 0 && inputPlaceholderIdx >= 0) {
    throw new Error("job args cannot include both __RUNNER_SECRETS_JSON__ and __RUNNER_INPUT_JSON__");
  }
  let tempSecretsPath = "";
  try {
    if (secretsPlaceholderIdx >= 0 || inputPlaceholderIdx >= 0) {
      const secrets = await params.secrets.waitOrPrompt({
        jobId: params.job.jobId,
        timeoutMs: params.secretsWaitMs,
        allowPrompt: params.allowPrompt,
      });
      tempSecretsPath =
        secretsPlaceholderIdx >= 0
          ? await writeSecretsJsonTemp(params.job.jobId, secrets)
          : await writeInputJsonTemp(params.job.jobId, secrets);
      if (secretsPlaceholderIdx >= 0) args[secretsPlaceholderIdx] = tempSecretsPath;
      if (inputPlaceholderIdx >= 0) args[inputPlaceholderIdx] = tempSecretsPath;
    }

    if (params.job.kind === "custom") {
      const output = await capture(process.execPath, [entry, ...args], {
        cwd: params.repoRoot,
        env: process.env,
        maxOutputBytes: 128 * 1024,
      });
      return { output: output.trim() || undefined };
    }
    await run(process.execPath, [entry, ...args], {
      cwd: params.repoRoot,
      env: process.env,
    });
    return {};
  } finally {
    if (tempSecretsPath) {
      try {
        await fs.rm(tempSecretsPath, { force: true });
      } catch {
        // best effort
      }
    }
  }
}

type RunnerAppendRunEventsArgs = Parameters<RunnerApiClient["appendRunEvents"]>[0];
type RunnerAppendEventsClient = Pick<RunnerApiClient, "appendRunEvents">;

async function appendRunEventsBestEffort(params: {
  client: RunnerAppendEventsClient;
  projectId: string;
  runId: string;
  events: RunnerAppendRunEventsArgs["events"];
  context: "command_start" | "command_output" | "command_end" | "command_end_error";
}): Promise<void> {
  try {
    await params.client.appendRunEvents({
      projectId: params.projectId,
      runId: params.runId,
      events: params.events,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`runner run-events append failed (${params.context}): ${message}`);
  }
}

async function executeLeasedJobWithRunEvents(params: {
  client: RunnerAppendEventsClient;
  projectId: string;
  job: RunnerLeaseJob;
  repoRoot: string;
  secrets: LocalSecretsBuffer;
  allowPrompt: boolean;
  secretsWaitMs: number;
  maxAttempts: number;
  executeJobFn?: typeof executeJob;
}): Promise<{ terminal: "succeeded" | "failed"; errorMessage?: string }> {
  const executeJobFn = params.executeJobFn ?? executeJob;
  try {
    if (params.job.attempt > params.maxAttempts) {
      throw new Error(`attempt cap exceeded (${params.job.attempt}/${params.maxAttempts})`);
    }
    await appendRunEventsBestEffort({
      client: params.client,
      projectId: params.projectId,
      runId: params.job.runId,
      context: "command_start",
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: `Runner leased job ${params.job.jobId} kind=${params.job.kind} attempt=${params.job.attempt}`,
          meta: { kind: "phase", phase: "command_start" },
        },
      ],
    });
    const result = await executeJobFn({
      job: params.job,
      repoRoot: params.repoRoot,
      secrets: params.secrets,
      allowPrompt: params.allowPrompt,
      secretsWaitMs: params.secretsWaitMs,
    });
    if (result.output) {
      await appendRunEventsBestEffort({
        client: params.client,
        projectId: params.projectId,
        runId: params.job.runId,
        context: "command_output",
        events: [
          {
            ts: Date.now(),
            level: "info",
            message: result.output,
          },
        ],
      });
    }
    await appendRunEventsBestEffort({
      client: params.client,
      projectId: params.projectId,
      runId: params.job.runId,
      context: "command_end",
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: `Runner completed job ${params.job.jobId}`,
          meta: { kind: "phase", phase: "command_end" },
        },
      ],
    });
    return { terminal: "succeeded" };
  } catch (err) {
    const errorMessage = sanitizeErrorMessage(err, "runner job failed");
    await appendRunEventsBestEffort({
      client: params.client,
      projectId: params.projectId,
      runId: params.job.runId,
      context: "command_end_error",
      events: [
        {
          ts: Date.now(),
          level: "error",
          message: errorMessage,
          meta: { kind: "phase", phase: "command_end" },
        },
      ],
    });
    return { terminal: "failed", errorMessage };
  }
}

export async function __test_appendRunEventsBestEffort(params: {
  client: RunnerAppendEventsClient;
  projectId: string;
  runId: string;
  events: RunnerAppendRunEventsArgs["events"];
  context: "command_start" | "command_output" | "command_end" | "command_end_error";
}): Promise<void> {
  await appendRunEventsBestEffort(params);
}

export async function __test_executeLeasedJobWithRunEvents(params: {
  client: RunnerAppendEventsClient;
  projectId: string;
  job: RunnerLeaseJob;
  maxAttempts: number;
  executeJobFn: typeof executeJob;
}): Promise<{ terminal: "succeeded" | "failed"; errorMessage?: string }> {
  return await executeLeasedJobWithRunEvents({
    client: params.client,
    projectId: params.projectId,
    job: params.job,
    repoRoot: process.cwd(),
    secrets: {} as LocalSecretsBuffer,
    allowPrompt: false,
    secretsWaitMs: 1,
    maxAttempts: params.maxAttempts,
    executeJobFn: params.executeJobFn,
  });
}

export const runnerStart = defineCommand({
  meta: {
    name: "start",
    description: "Start Model C runner agent (leases jobs, executes locally, reports metadata).",
  },
  args: {
    project: { type: "string", required: true, description: "Project id." },
    token: { type: "string", required: true, description: "Runner bearer token." },
    name: { type: "string", description: "Runner name." },
    repoRoot: { type: "string", description: "Repo root path (defaults to detected root)." },
    runtimeDir: { type: "string", description: "Runtime dir passthrough." },
    controlPlaneUrl: { type: "string", description: "Control plane base URL." },
    pollMs: { type: "string", description: "Idle poll interval ms.", default: "1200" },
    leaseTtlMs: { type: "string", description: "Lease TTL ms.", default: "30000" },
    heartbeatMs: { type: "string", description: "Runner heartbeat interval ms.", default: "10000" },
    maxAttempts: { type: "string", description: "Maximum lease attempts before failing a job.", default: "3" },
    localSecretsPort: { type: "string", description: "Local secrets submit port.", default: "43110" },
    dashboardOrigin: { type: "string", description: "Allowed browser origin for local secrets endpoint." },
    nonce: { type: "string", description: "CSRF nonce for local secrets endpoint." },
    secretsWaitMs: { type: "string", description: "Wait time for secrets submit before fallback prompt.", default: "60000" },
    once: { type: "boolean", description: "Process at most one leased job.", default: false },
  },
  async run({ args }) {
    const projectId = String((args as any).project || "").trim();
    const token = String((args as any).token || "").trim();
    if (!projectId) throw new Error("missing --project");
    if (!token) throw new Error("missing --token");

    const controlPlaneUrl = resolveControlPlaneUrl((args as any).controlPlaneUrl);
    const runnerName = String((args as any).name || `${envName()}-${os.hostname()}`).trim() || `runner-${os.hostname()}`;
    const pollMs = toInt((args as any).pollMs, 1200, 250, 30_000);
    const leaseTtlMs = toInt((args as any).leaseTtlMs, 30_000, 5_000, 120_000);
    const heartbeatMs = toInt((args as any).heartbeatMs, 10_000, 2_000, 120_000);
    const maxAttempts = toInt((args as any).maxAttempts, 3, 1, 25);
    const secretsWaitMs = toInt((args as any).secretsWaitMs, 60_000, 2_000, 300_000);
    const localSecretsPort = toInt((args as any).localSecretsPort, 43110, 1024, 65535);
    const dashboardOrigin = String((args as any).dashboardOrigin || "").trim();
    if (!dashboardOrigin) throw new Error("missing --dashboardOrigin for local secrets endpoint");
    const nonce = String((args as any).nonce || process.env["CLAWLETS_RUNNER_NONCE"] || "").trim() || createLocalSecretsNonce();
    const repoRoot = String((args as any).repoRoot || "").trim() || findRepoRoot(process.cwd());

    const client = new RunnerApiClient(controlPlaneUrl, token);
    const secrets = new LocalSecretsBuffer();

    await secrets.start({ port: localSecretsPort, nonce, allowedOrigin: dashboardOrigin });
    console.log(
      JSON.stringify(
        {
          ok: true,
          runner: {
            projectId,
            runnerName,
            controlPlaneUrl,
            repoRoot,
            localSecretsEndpoint: `http://127.0.0.1:${localSecretsPort}/secrets/submit`,
          },
        },
        null,
        2,
      ),
    );

    let running = true;
    const stop = () => {
      running = false;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    const sendHeartbeat = async (status: "online" | "offline") => {
      try {
        await client.heartbeat({
          projectId,
          runnerName,
          status,
          capabilities: {
            supportsLocalSecretsSubmit: true,
            supportsInteractiveSecrets: Boolean(process.stdin.isTTY),
            supportsInfraApply: true,
            localSecretsPort,
            localSecretsNonce: nonce,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`runner heartbeat error: ${message}`);
      }
    };

    await sendHeartbeat("online");
    const ticker = setInterval(() => {
      void sendHeartbeat("online");
    }, heartbeatMs);

    try {
      let leaseErrorStreak = 0;
      while (running) {
        let lease: Awaited<ReturnType<RunnerApiClient["leaseNext"]>>;
        try {
          lease = await client.leaseNext({ projectId, leaseTtlMs });
          leaseErrorStreak = 0;
        } catch (err) {
          const kind = classifyRunnerHttpError(err);
          const message = err instanceof Error ? err.message : String(err);
          if (kind === "auth" || kind === "permanent") {
            console.error(`runner lease failed (${kind}); stopping: ${message}`);
            break;
          }
          leaseErrorStreak += 1;
          const backoffMs = Math.min(30_000, Math.max(pollMs, pollMs * 2 ** Math.min(5, leaseErrorStreak)));
          console.error(`runner lease failed (${kind}); retrying in ${backoffMs}ms: ${message}`);
          await sleep(backoffMs);
          continue;
        }
        const job = lease.job;
        if (!job) {
          if ((args as any).once) break;
          await sleep(pollMs);
          continue;
        }

        const beat = setInterval(() => {
          void client
            .heartbeatJob({ projectId, jobId: job.jobId, leaseId: job.leaseId, leaseTtlMs })
            .catch((err) => console.error(`runner job heartbeat failed (${job.jobId}): ${String((err as Error)?.message || err)}`));
        }, Math.max(2000, Math.floor(leaseTtlMs / 2)));

        let terminal: "succeeded" | "failed" | "canceled" = "failed";
        let errorMessage: string | undefined;
        try {
          const execution = await executeLeasedJobWithRunEvents({
            client,
            projectId,
            job,
            repoRoot,
            secrets,
            allowPrompt: Boolean(process.stdin.isTTY),
            secretsWaitMs,
            maxAttempts,
          });
          terminal = execution.terminal;
          errorMessage = execution.errorMessage;
        } finally {
          clearInterval(beat);
        }

        let stopAfterCompletionError = false;
        try {
          const completion = await client.completeJob({
            projectId,
            jobId: job.jobId,
            leaseId: job.leaseId,
            status: terminal,
            errorMessage,
          });
          if (!completion.ok) {
            console.error(`runner completion rejected (${job.jobId}): lease/status mismatch`);
          }
        } catch (err) {
          const kind = classifyRunnerHttpError(err);
          const message = err instanceof Error ? err.message : String(err);
          if (shouldStopOnCompletionError(kind)) {
            stopAfterCompletionError = true;
            console.error(`runner completion failed (${kind}); stopping: ${message}`);
          } else {
            console.error(`runner completion failed (${kind}); continuing: ${message}`);
          }
        }

        try {
          const snapshot = await buildMetadataSnapshot({
            repoRoot,
            lastRunId: job.runId,
            lastRunStatus: terminal,
          });
          await client.syncMetadata({
            projectId,
            payload: snapshot,
          });
        } catch (err) {
          console.error(`metadata sync failed (${job.jobId}): ${String((err as Error)?.message || err)}`);
        }

        if (stopAfterCompletionError) {
          running = false;
        }

        if ((args as any).once) break;
      }
    } finally {
      clearInterval(ticker);
      await sendHeartbeat("offline");
      await secrets.stop();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  },
});
