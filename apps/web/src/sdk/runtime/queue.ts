import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConvexClient } from "~/server/convex";
import { assertRunBoundToProject } from "./binding";

type JobPayloadMeta = {
  hostName?: string;
  gatewayId?: string;
  scope?: "bootstrap" | "updates" | "openclaw";
  secretNames?: string[];
  configPaths?: string[];
  args?: string[];
  note?: string;
};

export async function requireAdminBoundRun(params: {
  client: ConvexClient;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  expectedKind: string;
  requireRunning?: boolean;
}): Promise<{ run: { kind: string; status: string } }> {
  const runGet = await params.client.query(api.controlPlane.runs.get, { runId: params.runId });
  if (!runGet || runGet.role !== "admin") throw new Error("admin required");
  if (!runGet.run) throw new Error("run not found");
  assertRunBoundToProject({
    runId: params.runId,
    runProjectId: runGet.run.projectId as Id<"projects">,
    expectedProjectId: params.projectId,
    runKind: runGet.run.kind,
    expectedKind: params.expectedKind,
  });
  if (params.requireRunning !== false && runGet.run.status !== "running") {
    throw new Error("run not running");
  }
  return { run: { kind: runGet.run.kind, status: runGet.run.status } };
}

export async function enqueueRunnerJobForRun(params: {
  client: ConvexClient;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  expectedKind: string;
  jobKind: string;
  title?: string;
  host?: string;
  payloadMeta?: JobPayloadMeta;
}): Promise<{ runId: Id<"runs">; jobId: Id<"jobs"> }> {
  await requireAdminBoundRun({
    client: params.client,
    projectId: params.projectId,
    runId: params.runId,
    expectedKind: params.expectedKind,
  });
  const queued = await params.client.mutation(api.controlPlane.jobs.enqueue, {
    projectId: params.projectId,
    runId: params.runId,
    kind: params.jobKind,
    title: params.title,
    host: params.host,
    payloadMeta: params.payloadMeta,
  });
  return queued;
}
