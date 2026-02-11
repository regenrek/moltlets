import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { createConvexClient } from "~/server/convex";
import { coerceString, coerceTrimmedString } from "~/sdk/runtime/strings";
import { validateGitRepoUrlPolicy, parseGitRemote } from "@clawlets/shared/lib/repo-url-policy";

const HOST_DEFAULT = "openclaw-fleet-host";
const RUNNER_REPO_PATH_MAX = 512;
const RUNNER_NAME_MAX = 128;
const TEMPLATE_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TEMPLATE_PATH_RE = /^[A-Za-z0-9._/-]+$/;
const TEMPLATE_REF_RE = /^[A-Za-z0-9._/-]+$/;

function forbidMultilineNul(value: string, field: string): void {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error(`${field} contains forbidden characters`);
  }
}

function getHost(input?: unknown): string {
  const value = coerceTrimmedString(input) || HOST_DEFAULT;
  forbidMultilineNul(value, "host");
  if (value.length > 128) throw new Error("host too long");
  return value;
}

function normalizeRunnerRepoPath(input: unknown): string {
  const raw = coerceString(input).trim();
  if (!raw) throw new Error("runnerRepoPath required");
  forbidMultilineNul(raw, "runnerRepoPath");
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  const out = normalized || "/";
  if (out.split("/").includes("..")) {
    throw new Error("runnerRepoPath cannot contain '..' path segments");
  }
  if (out.length > RUNNER_REPO_PATH_MAX) throw new Error("runnerRepoPath too long");
  return out;
}

function normalizeRunnerName(input: unknown): string {
  const value = coerceString(input).trim();
  if (!value) throw new Error("runnerName required");
  forbidMultilineNul(value, "runnerName");
  if (value.length > RUNNER_NAME_MAX) throw new Error("runnerName too long");
  return value;
}

function normalizeTemplateRepo(input: unknown): string | undefined {
  const value = coerceString(input).trim();
  if (!value) return undefined;
  forbidMultilineNul(value, "templateRepo");
  if (!TEMPLATE_REPO_RE.test(value)) throw new Error("templateRepo must be owner/repo");
  return value;
}

function normalizeTemplatePath(input: unknown): string | undefined {
  const value = coerceString(input).trim();
  if (!value) return undefined;
  forbidMultilineNul(value, "templatePath");
  if (value.startsWith("/")) throw new Error("templatePath must be relative");
  if (value.includes("..") || !TEMPLATE_PATH_RE.test(value)) throw new Error("templatePath invalid");
  return value;
}

function normalizeTemplateRef(input: unknown): string | undefined {
  const value = coerceString(input).trim();
  if (!value) return undefined;
  forbidMultilineNul(value, "templateRef");
  if (!TEMPLATE_REF_RE.test(value)) throw new Error("templateRef invalid");
  return value;
}

function normalizeCloneRepoUrl(input: unknown): string {
  const value = coerceString(input).trim();
  if (!value) throw new Error("repoUrl required");
  const validated = validateGitRepoUrlPolicy(value);
  if (!validated.ok) {
    if (validated.error.code === "file_forbidden") throw new Error("repoUrl file: urls are not allowed");
    if (validated.error.code === "invalid_protocol") throw new Error("repoUrl invalid protocol");
    if (validated.error.code === "host_not_allowed") throw new Error("repoUrl host is not allowed");
    if (validated.error.code === "invalid_host") throw new Error("repoUrl invalid host");
    throw new Error("repoUrl invalid");
  }
  return validated.repoUrl;
}

function canonicalizeRepoIdentity(repoUrl: string): string {
  const remote = parseGitRemote(repoUrl);
  if (remote?.kind === "scp") {
    const [lhs, rhs] = repoUrl.split(":", 2);
    const [user, host] = (lhs ?? "").split("@", 2);
    const cleanPath = (rhs || "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "");
    if (!user || !host || !cleanPath) throw new Error("repoUrl invalid");
    return `${user}@${host.toLowerCase()}:${cleanPath}`;
  }
  const parsed = new URL(repoUrl);
  const pathname = (parsed.pathname || "/")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "") || "/";
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function parseDepth(input: unknown): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const value = typeof input === "number" ? input : Number.parseInt(coerceString(input).trim(), 10);
  if (!Number.isFinite(value)) throw new Error("depth invalid");
  const depth = Math.trunc(value);
  if (depth < 1 || depth > 1000) throw new Error("depth must be between 1 and 1000");
  return depth;
}

function parseBranch(input: unknown): string | undefined {
  const branch = coerceString(input).trim();
  if (!branch) return undefined;
  forbidMultilineNul(branch, "branch");
  if (branch.length > 256) throw new Error("branch too long");
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("branch invalid");
  return branch;
}

function buildSeededWorkspaceRef(runnerRepoPath: string): { kind: "git"; id: string } {
  const digest = createHash("sha256").update(runnerRepoPath, "utf8").digest("hex");
  return { kind: "git", id: `seeded:sha256:${digest}` };
}

export const projectCreateStart = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    return {
      name: coerceString(d["name"]),
      runnerRepoPath: normalizeRunnerRepoPath(d["runnerRepoPath"]),
      host: getHost(d["host"]),
      runnerName: normalizeRunnerName(d["runnerName"]),
      templateRepo: normalizeTemplateRepo(d["templateRepo"]),
      templatePath: normalizeTemplatePath(d["templatePath"]),
      templateRef: normalizeTemplateRef(d["templateRef"]),
    };
  })
  .handler(async ({ data }) => {
    const client = createConvexClient();
    const workspaceRef = buildSeededWorkspaceRef(data.runnerRepoPath);

    const { projectId } = await client.mutation(api.controlPlane.projects.create, {
      name: data.name,
      executionMode: "remote_runner",
      workspaceRef,
      runnerRepoPath: data.runnerRepoPath,
    });
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId,
      kind: "project_init",
      title: "Create project",
      host: data.host,
    });
    await client.mutation(api.controlPlane.jobs.enqueue, {
      projectId,
      runId,
      kind: "project_init",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
        templateRepo: data.templateRepo,
        templatePath: data.templatePath,
        templateRef: data.templateRef,
      },
      title: "Initialize project repo",
    });
    await client.mutation(api.controlPlane.runEvents.appendBatch, {
      runId,
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: "Project init queued. Waiting for runner to start and lease the job.",
        },
      ],
    });
    const tokenResult = await client.mutation(api.controlPlane.runnerTokens.create, {
      projectId,
      runnerName: data.runnerName,
    });
    return {
      projectId: projectId as Id<"projects">,
      runId: runId as Id<"runs">,
      host: data.host,
      runnerName: data.runnerName,
      runnerRepoPath: data.runnerRepoPath,
      token: tokenResult.token,
    };
  });

export const projectImport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    const repoUrl = normalizeCloneRepoUrl(d["repoUrl"]);
    return {
      name: coerceString(d["name"]),
      repoUrl,
      repoIdentity: canonicalizeRepoIdentity(repoUrl),
      runnerRepoPath: normalizeRunnerRepoPath(d["runnerRepoPath"]),
      runnerName: normalizeRunnerName(d["runnerName"]),
      branch: parseBranch(d["branch"]),
      depth: parseDepth(d["depth"]),
    };
  })
  .handler(async ({ data }) => {
    const client = createConvexClient();
    const { projectId } = await client.mutation(api.controlPlane.projects.create, {
      name: data.name,
      executionMode: "remote_runner",
      workspaceRef: { kind: "git", id: data.repoIdentity },
      runnerRepoPath: data.runnerRepoPath,
    });
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId,
      kind: "project_import",
      title: "Import project",
    });
    await client.mutation(api.controlPlane.jobs.enqueue, {
      projectId,
      runId,
      kind: "project_import",
      payloadMeta: {
        repoUrl: data.repoUrl,
        branch: data.branch,
        depth: data.depth,
      },
      title: "Clone project repo",
    });
    await client.mutation(api.controlPlane.runEvents.appendBatch, {
      runId,
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: "Project import queued. Waiting for runner to start and lease the job.",
        },
      ],
    });
    const tokenResult = await client.mutation(api.controlPlane.runnerTokens.create, {
      projectId,
      runnerName: data.runnerName,
    });
    return {
      projectId: projectId as Id<"projects">,
      runId: runId as Id<"runs">,
      runnerName: data.runnerName,
      runnerRepoPath: data.runnerRepoPath,
      token: tokenResult.token,
      repoUrl: data.repoUrl,
    };
  });

export const projectRetryInit = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throw new Error("invalid input");
    const d = data as Record<string, unknown>;
    const projectId = coerceString(d["projectId"]).trim() as Id<"projects">;
    if (!projectId) throw new Error("projectId required");
    return {
      projectId,
      host: getHost(d["host"]),
    };
  })
  .handler(async ({ data }) => {
    const client = createConvexClient();
    await client.mutation(api.controlPlane.projects.update, {
      projectId: data.projectId,
      status: "creating",
    });
    const { runId } = await client.mutation(api.controlPlane.runs.create, {
      projectId: data.projectId,
      kind: "project_init",
      title: "Retry project init",
      host: data.host,
    });
    await client.mutation(api.controlPlane.jobs.enqueue, {
      projectId: data.projectId,
      runId,
      kind: "project_init",
      host: data.host,
      payloadMeta: {
        hostName: data.host,
      },
      title: "Initialize project repo",
    });
    await client.mutation(api.controlPlane.runEvents.appendBatch, {
      runId,
      events: [
        {
          ts: Date.now(),
          level: "info",
          message: "Project init retry queued. Waiting for runner to lease the job.",
        },
      ],
    });
    return { runId: runId as Id<"runs"> };
  });
