import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import { capture, run } from "@clawlets/core/lib/runtime/run";
import { findRepoRoot } from "@clawlets/core/lib/project/repo";
import { sanitizeErrorMessage } from "@clawlets/core/lib/runtime/safe-error";
import { DEPLOY_CREDS_KEYS } from "@clawlets/core/lib/infra/deploy-creds";
import { buildDefaultArgsForJobKind } from "@clawlets/core/lib/runtime/runner-command-policy";
import {
  RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES,
  RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES,
} from "@clawlets/core/lib/runtime/runner-command-policy-args";
import { resolveRunnerJobCommand } from "@clawlets/core/lib/runtime/runner-command-policy-resolve";
import { coerceTrimmedString } from "@clawlets/shared/lib/strings";
import { classifyRunnerHttpError, RunnerApiClient, type RunnerLeaseJob } from "./client.js";
import { buildMetadataSnapshot } from "./metadata.js";
import {
  loadOrCreateRunnerSealedInputKeypair,
  resolveRunnerSealedInputKeyPath,
  unsealRunnerInput,
} from "./sealed-input.js";

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
  return coerceTrimmedString(value).replace(/\/+$/, "");
}

function resolveControlPlaneUrl(raw: unknown): string {
  const arg = coerceTrimmedString(raw);
  if (arg) return normalizeBaseUrl(arg);
  const env =
    String(process.env["CLAWLETS_CONTROL_PLANE_URL"] || "").trim() ||
    String(process.env["CONVEX_SITE_URL"] || "").trim();
  if (!env) {
    throw new Error("missing control-plane url (--control-plane-url or CLAWLETS_CONTROL_PLANE_URL)");
  }
  return normalizeBaseUrl(env);
}

function runnerCommandEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    CI: "1",
    CLAWLETS_NON_INTERACTIVE: "1",
  };
}

function gitJobEnv(): Record<string, string | undefined> {
  return {
    ...runnerCommandEnv(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    GIT_ALLOW_PROTOCOL: "ssh:https",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RUNNER_COMMAND_RESULT_MAX_BYTES = RUNNER_COMMAND_RESULT_SMALL_MAX_BYTES;
const RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES_LIMIT = RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES;
const RUNNER_LOG_CAPTURE_MAX_BYTES = 128 * 1024;

function parseStructuredJsonObject(raw: string, maxBytes: number): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("runner command output missing JSON payload");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("runner command output is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("runner command JSON payload must be an object");
  }
  const normalized = JSON.stringify(parsed);
  const normalizedBytes = Buffer.byteLength(normalized, "utf8");
  if (!normalized || normalizedBytes > maxBytes) {
    throw new Error("runner command JSON payload too large");
  }
  return normalized;
}

function placeholderIndex(args: string[], placeholder: "__RUNNER_SECRETS_JSON__" | "__RUNNER_INPUT_JSON__"): number {
  let index = -1;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== placeholder) continue;
    if (index >= 0) throw new Error(`job args cannot include ${placeholder} more than once`);
    index = i;
  }
  return index;
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
    ...(adminPasswordHash ? { adminPasswordHash } : {}),
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
  const args = buildDefaultArgsForJobKind({
    kind: job.kind,
    payloadMeta: job.payloadMeta,
  });
  if (!args || args.length === 0) throw new Error(`job ${job.kind} requires payloadMeta.args`);
  return args;
}

export function __test_defaultArgsForJob(job: RunnerLeaseJob): string[] {
  return defaultArgsForJob(job);
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

export function __test_parseStructuredJsonObject(raw: string, maxBytes: number): string {
  return parseStructuredJsonObject(raw, maxBytes);
}

function parseSealedInputStringMap(rawJson: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("sealed input plaintext is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sealed input plaintext must be an object");
  }
  const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const name = key.trim();
    if (!name) continue;
    if (forbiddenKeys.has(name)) throw new Error(`sealed input key forbidden: ${name}`);
    if (typeof value !== "string") throw new Error(`sealed input field ${name} must be string`);
    out[name] = value;
  }
  return out;
}

function validateSealedInputKeysForJob(params: {
  job: RunnerLeaseJob;
  values: Record<string, string>;
  secretsPlaceholder: boolean;
  inputPlaceholder: boolean;
}): void {
  if (params.secretsPlaceholder && params.inputPlaceholder) {
    throw new Error("job args cannot include both __RUNNER_SECRETS_JSON__ and __RUNNER_INPUT_JSON__");
  }
  if (!params.secretsPlaceholder && !params.inputPlaceholder) return;

  const seen = Object.keys(params.values);
  if (params.inputPlaceholder) {
    const updatedKeys = Array.isArray(params.job.payloadMeta?.updatedKeys)
      ? params.job.payloadMeta?.updatedKeys?.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean)
      : [];
    if (updatedKeys.length === 0) {
      throw new Error("payloadMeta.updatedKeys required for __RUNNER_INPUT_JSON__ job");
    }
    const deployKeySet = new Set<string>(DEPLOY_CREDS_KEYS);
    const allowed = new Set<string>();
    for (const key of updatedKeys) {
      if (!deployKeySet.has(key)) throw new Error(`invalid updatedKeys entry: ${key}`);
      allowed.add(key);
    }
    for (const key of seen) {
      if (!allowed.has(key)) throw new Error(`sealed input key not allowlisted: ${key}`);
    }
    return;
  }

  const secretNames = Array.isArray(params.job.payloadMeta?.secretNames)
    ? params.job.payloadMeta?.secretNames?.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean)
    : [];
  const allowed = new Set<string>(["adminPasswordHash", "tailscaleAuthKey", ...secretNames]);
  for (const key of seen) {
    if (!allowed.has(key)) throw new Error(`sealed input secret not allowlisted: ${key}`);
  }
}

export function __test_parseSealedInputStringMap(rawJson: string): Record<string, string> {
  return parseSealedInputStringMap(rawJson);
}

export function __test_validateSealedInputKeysForJob(params: {
  job: RunnerLeaseJob;
  values: Record<string, string>;
  secretsPlaceholder: boolean;
  inputPlaceholder: boolean;
}): void {
  validateSealedInputKeysForJob(params);
}

async function executeJob(params: {
  job: RunnerLeaseJob;
  repoRoot: string;
  projectId: string;
  runnerPrivateKeyPem: string;
}): Promise<{ output?: string; redactedOutput?: boolean; commandResultJson?: string; commandResultLargeJson?: string }> {
  const entry = process.argv[1];
  if (!entry) throw new Error("unable to resolve cli entry path");
  const resolved = await resolveRunnerJobCommand({
    kind: params.job.kind,
    payloadMeta: params.job.payloadMeta,
    repoRoot: params.repoRoot,
  });
  if (!resolved.ok) throw new Error(resolved.error);
  const args = [...resolved.args];
  if (args.length === 0) throw new Error("job args empty");
  const secretsPlaceholderIdx = placeholderIndex(args, "__RUNNER_SECRETS_JSON__");
  const inputPlaceholderIdx = placeholderIndex(args, "__RUNNER_INPUT_JSON__");
  if (secretsPlaceholderIdx >= 0 && inputPlaceholderIdx >= 0) {
    throw new Error("job args cannot include both __RUNNER_SECRETS_JSON__ and __RUNNER_INPUT_JSON__");
  }
  const secretBearingJob = secretsPlaceholderIdx >= 0 || inputPlaceholderIdx >= 0;
  const secretOutputPolicy = secretBearingJob
    ? ({
        stdout: "ignore",
        stderr: "ignore",
      } as const)
    : ({} as const);
  let tempSecretsPath = "";
  try {
    if (secretBearingJob) {
      if (!params.job.sealedInputB64) {
        throw new Error("sealed input missing for placeholder job");
      }
      const targetRunnerId = String(params.job.targetRunnerId || "").trim();
      if (!targetRunnerId) throw new Error("target runner missing for placeholder job");
      const aad = `${params.projectId}:${params.job.jobId}:${params.job.kind}:${targetRunnerId}`;
      const plaintextJson = unsealRunnerInput({
        runnerPrivateKeyPem: params.runnerPrivateKeyPem,
        aad,
        envelopeB64: params.job.sealedInputB64,
        expectedAlg: params.job.sealedInputAlg,
        expectedKeyId: params.job.sealedInputKeyId,
      });
      const secrets = parseSealedInputStringMap(plaintextJson);
      validateSealedInputKeysForJob({
        job: params.job,
        values: secrets,
        secretsPlaceholder: secretsPlaceholderIdx >= 0,
        inputPlaceholder: inputPlaceholderIdx >= 0,
      });
      tempSecretsPath =
        secretsPlaceholderIdx >= 0
          ? await writeSecretsJsonTemp(params.job.jobId, secrets)
          : await writeInputJsonTemp(params.job.jobId, secrets);
      if (secretsPlaceholderIdx >= 0) args[secretsPlaceholderIdx] = tempSecretsPath;
      if (inputPlaceholderIdx >= 0) args[inputPlaceholderIdx] = tempSecretsPath;
    }

    if (params.job.kind === "custom") {
      if (resolved.exec !== "clawlets") throw new Error("custom jobs must execute via clawlets CLI");
      if (secretBearingJob) {
        await run(process.execPath, [entry, ...args], {
          cwd: params.repoRoot,
          env: runnerCommandEnv(),
          stdin: "ignore",
          ...secretOutputPolicy,
        });
        return {};
      }
      const structuredSmallResult = resolved.resultMode === "json_small";
      const structuredLargeResult = resolved.resultMode === "json_large";
      const captureLimit =
        structuredLargeResult
          ? Math.max(
              1,
              Math.min(
                RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES_LIMIT,
                Math.trunc(resolved.resultMaxBytes ?? RUNNER_COMMAND_RESULT_LARGE_MAX_BYTES_LIMIT),
              ),
            )
          : structuredSmallResult
            ? RUNNER_COMMAND_RESULT_MAX_BYTES
            : RUNNER_LOG_CAPTURE_MAX_BYTES;
      const output = await capture(process.execPath, [entry, ...args], {
        cwd: params.repoRoot,
        env: runnerCommandEnv(),
        stdin: "ignore",
        maxOutputBytes: captureLimit,
      });
      if (structuredSmallResult) {
        const normalized = parseStructuredJsonObject(output, RUNNER_COMMAND_RESULT_MAX_BYTES);
        return { redactedOutput: true, commandResultJson: normalized };
      }
      if (structuredLargeResult) {
        const normalized = parseStructuredJsonObject(output, captureLimit);
        return { redactedOutput: true, commandResultLargeJson: normalized };
      }
      return { output: output.trim() || undefined };
    }
    if (resolved.exec === "git") {
      await run("git", args, {
        cwd: params.repoRoot,
        env: gitJobEnv(),
        stdin: "ignore",
        ...secretOutputPolicy,
      });
      return {};
    }
    await run(process.execPath, [entry, ...args], {
      cwd: params.repoRoot,
      env: runnerCommandEnv(),
      stdin: "ignore",
      ...secretOutputPolicy,
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

export async function __test_executeJob(params: Parameters<typeof executeJob>[0]) {
  return await executeJob(params);
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
  runnerPrivateKeyPem: string;
  maxAttempts: number;
  executeJobFn?: typeof executeJob;
}): Promise<{ terminal: "succeeded" | "failed"; errorMessage?: string; commandResultJson?: string; commandResultLargeJson?: string }> {
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
      projectId: params.projectId,
      runnerPrivateKeyPem: params.runnerPrivateKeyPem,
    });
    if (result.redactedOutput) {
      await appendRunEventsBestEffort({
        client: params.client,
        projectId: params.projectId,
        runId: params.job.runId,
        context: "command_output",
        events: [
          {
            ts: Date.now(),
            level: "info",
            message: "Runner command output redacted (structured JSON result stored ephemerally).",
            redacted: true,
          },
        ],
      });
    } else if (result.output) {
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
    return {
      terminal: "succeeded",
      commandResultJson: result.commandResultJson,
      commandResultLargeJson: result.commandResultLargeJson,
    };
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
}): Promise<{ terminal: "succeeded" | "failed"; errorMessage?: string; commandResultJson?: string; commandResultLargeJson?: string }> {
  return await executeLeasedJobWithRunEvents({
    client: params.client,
    projectId: params.projectId,
    job: params.job,
    repoRoot: process.cwd(),
    runnerPrivateKeyPem: "test",
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
    const repoRoot = String((args as any).repoRoot || "").trim() || findRepoRoot(process.cwd());
    const runtimeDir = coerceTrimmedString((args as any).runtimeDir);
    const sealedKeyPath = await resolveRunnerSealedInputKeyPath({
      runtimeDir: runtimeDir || undefined,
      projectId,
      runnerName,
    });
    const sealedKeyPair = await loadOrCreateRunnerSealedInputKeypair({ privateKeyPath: sealedKeyPath });

    const client = new RunnerApiClient(controlPlaneUrl, token);
    console.log(
      JSON.stringify(
        {
          ok: true,
          runner: {
            projectId,
            runnerName,
            controlPlaneUrl,
            repoRoot,
            sealedInput: {
              alg: sealedKeyPair.alg,
              keyId: sealedKeyPair.keyId,
            },
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
            supportsSealedInput: true,
            sealedInputAlg: sealedKeyPair.alg,
            sealedInputPubSpkiB64: sealedKeyPair.publicKeySpkiB64,
            sealedInputKeyId: sealedKeyPair.keyId,
            supportsInfraApply: true,
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
        let commandResultJson: string | undefined;
        let commandResultLargeJson: string | undefined;
        try {
          const execution = await executeLeasedJobWithRunEvents({
            client,
            projectId,
            job,
            repoRoot,
            runnerPrivateKeyPem: sealedKeyPair.privateKeyPem,
            maxAttempts,
          });
          terminal = execution.terminal;
          errorMessage = execution.errorMessage;
          commandResultJson = execution.commandResultJson;
          commandResultLargeJson = execution.commandResultLargeJson;
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
            ...(commandResultJson ? { commandResultJson } : {}),
            ...(commandResultLargeJson ? { commandResultLargeJson } : {}),
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
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  },
});
