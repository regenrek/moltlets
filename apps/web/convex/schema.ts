import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { RUN_EVENT_LEVELS, RUN_KINDS, RUN_STATUSES } from "@clawlets/core/lib/runtime/run-constants";
import {
  JOB_STATUSES,
  HOST_STATUSES,
  RUNNER_STATUSES,
  SECRET_WIRING_SCOPES,
  SECRET_WIRING_STATUSES,
} from "@clawlets/core/lib/runtime/control-plane-constants";
import { PROJECT_DELETION_STAGES } from "./shared/projectErasureStages";

function literals<const T extends readonly string[]>(values: T) {
  return values.map((value) => v.literal(value));
}

export const RunKind = v.union(...literals(RUN_KINDS));
export const RunStatus = v.union(...literals(RUN_STATUSES));
export const RunEventLevel = v.union(...literals(RUN_EVENT_LEVELS));
export const HostStatus = v.union(...literals(HOST_STATUSES));
export const RunnerStatus = v.union(...literals(RUNNER_STATUSES));
export const SecretWiringScope = v.union(...literals(SECRET_WIRING_SCOPES));
export const SecretWiringStatus = v.union(...literals(SECRET_WIRING_STATUSES));
export const JobStatus = v.union(...literals(JOB_STATUSES));
export const RunEventMeta = v.union(
  v.object({
    kind: v.literal("phase"),
    phase: v.union(
      v.literal("command_start"),
      v.literal("command_end"),
      v.literal("post_run_cleanup"),
      v.literal("truncated"),
    ),
  }),
  v.object({
    kind: v.literal("exit"),
    code: v.number(),
  }),
);

export const Role = v.union(v.literal("admin"), v.literal("viewer"));
export const ProjectStatus = v.union(v.literal("creating"), v.literal("ready"), v.literal("error"));
export const ExecutionMode = v.union(v.literal("local"), v.literal("remote_runner"));
export const WorkspaceRef = v.object({
  kind: v.union(v.literal("local"), v.literal("git")),
  id: v.string(),
  relPath: v.optional(v.string()),
});
export const GitWritePolicy = v.union(v.literal("pr_only"), v.literal("direct_commit_enabled"));
export const ProjectDeletionStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);
export const ProjectDeletionStage = v.union(...literals(PROJECT_DELETION_STAGES));
export const AuditAction = v.union(
  v.literal("bootstrap"),
  v.literal("config.migrate"),
  v.literal("deployCreds.update"),
  v.literal("gateway.openclaw.harden"),
  v.literal("gateway.openclaw.write"),
  v.literal("gateway.preset.apply"),
  v.literal("lockdown"),
  v.literal("openclaw.schema.live.fetch"),
  v.literal("project.delete.confirm"),
  v.literal("project.delete.start"),
  v.literal("project.policy.update"),
  v.literal("secrets.init"),
  v.literal("secrets.sync"),
  v.literal("secrets.verify"),
  v.literal("secrets.write"),
  v.literal("server.audit"),
  v.literal("server.channels"),
  v.literal("server.restart"),
  v.literal("server.update.apply"),
  v.literal("sops.operatorKey.generate"),
  v.literal("workspace.common.write"),
  v.literal("workspace.gateway.reset"),
  v.literal("workspace.gateway.write"),
);

const AuditSecretsScope = v.union(
  v.literal("bootstrap"),
  v.literal("updates"),
  v.literal("openclaw"),
  v.literal("all"),
);

const AuditChannelOp = v.union(
  v.literal("status"),
  v.literal("capabilities"),
  v.literal("login"),
  v.literal("logout"),
);

export const AuditTarget = v.union(
  v.object({ host: v.string(), mode: v.union(v.literal("nixos-anywhere"), v.literal("image")) }),
  v.object({ host: v.string() }),
  v.object({ host: v.string(), gatewayId: v.string(), op: AuditChannelOp }),
  v.object({ host: v.string(), unit: v.string() }),
  v.object({ host: v.string(), gatewayId: v.string() }),
  v.object({ gatewayId: v.string() }),
  v.object({ to: v.number(), file: v.string() }),
  v.object({ doc: v.string() }),
  v.object({ gatewayId: v.string(), doc: v.string() }),
  v.object({ projectId: v.id("projects") }),
);

export const AuditData = v.union(
  v.object({ runId: v.id("runs") }),
  v.object({ runId: v.id("runs"), scope: AuditSecretsScope }),
  v.object({ secrets: v.array(v.string()) }),
  v.object({ warnings: v.array(v.string()), runId: v.id("runs") }),
  v.object({ updatedKeys: v.array(v.string()) }),
  v.object({ operatorIdHash: v.string() }),
  v.object({ preset: v.string(), runId: v.id("runs"), warnings: v.array(v.string()) }),
  v.object({ runId: v.id("runs"), changesCount: v.number(), warningsCount: v.number() }),
  v.object({ retentionDays: v.number(), gitWritePolicy: GitWritePolicy }),
  v.object({ tokenExpiresAt: v.number() }),
  v.object({ deletionJobId: v.id("projectDeletionJobs") }),
);
export const ProjectConfigType = v.union(
  v.literal("fleet"),
  v.literal("host"),
  v.literal("gateway"),
  v.literal("provider"),
  v.literal("raw"),
);
export const ProviderType = v.union(v.literal("discord"), v.literal("telegram"));
export const DesiredHostSummary = v.object({
  enabled: v.optional(v.boolean()),
  provider: v.optional(v.string()),
  region: v.optional(v.string()),
  gatewayCount: v.optional(v.number()),
  gatewayArchitecture: v.optional(v.string()),
  updateRing: v.optional(v.string()),
  theme: v.optional(v.string()),
  sshExposureMode: v.optional(v.string()),
  targetHost: v.optional(v.string()),
  tailnetMode: v.optional(v.string()),
  selfUpdateEnabled: v.optional(v.boolean()),
  selfUpdateChannel: v.optional(v.string()),
  selfUpdateBaseUrlCount: v.optional(v.number()),
  selfUpdatePublicKeyCount: v.optional(v.number()),
  selfUpdateAllowUnsigned: v.optional(v.boolean()),
});
export const DesiredGatewaySummary = v.object({
  enabled: v.optional(v.boolean()),
  channelCount: v.optional(v.number()),
  personaCount: v.optional(v.number()),
  provider: v.optional(v.string()),
  channels: v.optional(v.array(v.string())),
  personaIds: v.optional(v.array(v.string())),
  port: v.optional(v.number()),
});
export const ProviderConfigSummary = v.object({
  displayName: v.optional(v.string()),
});
export const JobPayloadMeta = v.object({
  hostName: v.optional(v.string()),
  gatewayId: v.optional(v.string()),
  scope: v.optional(SecretWiringScope),
  secretNames: v.optional(v.array(v.string())),
  configPaths: v.optional(v.array(v.string())),
  args: v.optional(v.array(v.string())),
  note: v.optional(v.string()),
});
export const RunnerCapabilities = v.object({
  supportsLocalSecretsSubmit: v.optional(v.boolean()),
  supportsInteractiveSecrets: v.optional(v.boolean()),
  supportsInfraApply: v.optional(v.boolean()),
  localSecretsPort: v.optional(v.number()),
  localSecretsNonce: v.optional(v.string()),
});

const schema = defineSchema({
  users: defineTable({
    authUserId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    pictureUrl: v.optional(v.string()),
    role: Role,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_role", ["role"]),

  projects: defineTable({
    ownerUserId: v.id("users"),
    name: v.string(),
    executionMode: ExecutionMode,
    workspaceRef: WorkspaceRef,
    workspaceRefKey: v.string(),
    localPath: v.optional(v.string()),
    status: ProjectStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_name", ["ownerUserId", "name"])
    .index("by_owner_workspaceRefKey", ["ownerUserId", "workspaceRefKey"])
    .index("by_owner_localPath", ["ownerUserId", "localPath"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: Role,
    createdAt: v.number(),
  })
    .index("by_project_user", ["projectId", "userId"])
    .index("by_user", ["userId"]),

  projectConfigs: defineTable({
    projectId: v.id("projects"),
    type: ProjectConfigType,
    path: v.string(),
    lastHash: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "type"])
    .index("by_project_path", ["projectId", "path"]),

  hosts: defineTable({
    projectId: v.id("projects"),
    hostName: v.string(),
    provider: v.optional(v.string()),
    region: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
    lastStatus: v.optional(HostStatus),
    lastRunId: v.optional(v.id("runs")),
    lastRunStatus: v.optional(RunStatus),
    desired: v.optional(DesiredHostSummary),
  })
    .index("by_project", ["projectId"])
    .index("by_project_host", ["projectId", "hostName"]),

  gateways: defineTable({
    projectId: v.id("projects"),
    hostName: v.string(),
    gatewayId: v.string(),
    lastSeenAt: v.optional(v.number()),
    lastStatus: v.optional(HostStatus),
    desired: v.optional(DesiredGatewaySummary),
  })
    .index("by_project", ["projectId"])
    .index("by_project_host", ["projectId", "hostName"])
    .index("by_project_host_gateway", ["projectId", "hostName", "gatewayId"]),

  secretWiring: defineTable({
    projectId: v.id("projects"),
    hostName: v.string(),
    secretName: v.string(),
    scope: SecretWiringScope,
    status: SecretWiringStatus,
    required: v.boolean(),
    lastVerifiedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_host", ["projectId", "hostName"])
    .index("by_project_host_secret", ["projectId", "hostName", "secretName"]),

  runs: defineTable({
    projectId: v.id("projects"),
    kind: RunKind,
    status: RunStatus,
    title: v.optional(v.string()),
    host: v.optional(v.string()),
    initiatedByUserId: v.id("users"),
    createdAt: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_project_startedAt", ["projectId", "startedAt"])
    .index("by_project_host_startedAt", ["projectId", "host", "startedAt"])
    .index("by_project_host_kind_startedAt", ["projectId", "host", "kind", "startedAt"])
    .index("by_project_status", ["projectId", "status"]),

  runEvents: defineTable({
    projectId: v.id("projects"),
    runId: v.id("runs"),
    ts: v.number(),
    level: RunEventLevel,
    message: v.string(),
    meta: v.optional(RunEventMeta),
    redacted: v.optional(v.boolean()),
  })
    .index("by_run_ts", ["runId", "ts"])
    .index("by_project_ts", ["projectId", "ts"]),

  providers: defineTable({
    projectId: v.id("projects"),
    type: ProviderType,
    enabled: v.boolean(),
    config: v.optional(ProviderConfigSummary), // non-secret
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_type", ["projectId", "type"]),

  runners: defineTable({
    projectId: v.id("projects"),
    runnerName: v.string(),
    lastSeenAt: v.number(),
    lastStatus: RunnerStatus,
    version: v.optional(v.string()),
    capabilities: v.optional(RunnerCapabilities),
  })
    .index("by_project", ["projectId"])
    .index("by_project_runner", ["projectId", "runnerName"]),

  runnerTokens: defineTable({
    projectId: v.id("projects"),
    runnerId: v.id("runners"),
    tokenHash: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_runner", ["runnerId"])
    .index("by_tokenHash", ["tokenHash"]),

  jobs: defineTable({
    projectId: v.id("projects"),
    runId: v.id("runs"),
    kind: v.string(),
    status: JobStatus,
    payload: v.optional(JobPayloadMeta),
    payloadHash: v.optional(v.string()),
    leaseId: v.optional(v.string()),
    leasedByRunnerId: v.optional(v.id("runners")),
    leaseExpiresAt: v.optional(v.number()),
    attempt: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_project_createdAt", ["projectId", "createdAt"]),

  auditLogs: defineTable({
    ts: v.number(),
    userId: v.id("users"),
    projectId: v.optional(v.id("projects")),
    action: AuditAction,
    target: v.optional(AuditTarget),
    data: v.optional(AuditData),
  })
    .index("by_project_ts", ["projectId", "ts"])
    .index("by_user_ts", ["userId", "ts"]),

  projectPolicies: defineTable({
    projectId: v.id("projects"),
    retentionDays: v.number(),
    gitWritePolicy: GitWritePolicy,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  projectDeletionTokens: defineTable({
    projectId: v.id("projects"),
    tokenHash: v.string(),
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_project", ["projectId"]),

  projectDeletionJobs: defineTable({
    projectId: v.id("projects"),
    requestedByUserId: v.id("users"),
    status: ProjectDeletionStatus,
    stage: ProjectDeletionStage,
    lastError: v.optional(v.string()),
    processed: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"]),

  retentionSweeps: defineTable({
    key: v.string(),
    cursor: v.optional(v.string()),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
});

export default schema;
