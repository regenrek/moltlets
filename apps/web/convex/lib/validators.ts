import { v } from "convex/values";

import {
  AuditAction,
  AuditData,
  AuditTarget,
  ExecutionMode,
  GitWritePolicy,
  ProjectConfigType,
  ProjectDeletionStage,
  ProjectDeletionStatus,
  ProjectStatus,
  ProviderType,
  Role,
  RunEventLevel,
  RunEventMeta,
  RunKind,
  RunStatus,
  WorkspaceRef,
} from "../schema";

export const UserDoc = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  tokenIdentifier: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  pictureUrl: v.optional(v.string()),
  role: Role,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const ProjectDoc = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
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
});

export const ProjectMemberDoc = v.object({
  _id: v.id("projectMembers"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  userId: v.id("users"),
  role: Role,
  createdAt: v.number(),
});

export const ProjectConfigDoc = v.object({
  _id: v.id("projectConfigs"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  type: ProjectConfigType,
  path: v.string(),
  lastHash: v.optional(v.string()),
  lastSyncAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
});

export const RunDoc = v.object({
  _id: v.id("runs"),
  _creationTime: v.number(),
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
});

export const RunEventDoc = v.object({
  _id: v.id("runEvents"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  runId: v.id("runs"),
  ts: v.number(),
  level: RunEventLevel,
  message: v.string(),
  meta: v.optional(RunEventMeta),
  redacted: v.optional(v.boolean()),
});

export const ProviderDoc = v.object({
  _id: v.id("providers"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  type: ProviderType,
  enabled: v.boolean(),
  config: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const AuditLogDoc = v.object({
  _id: v.id("auditLogs"),
  _creationTime: v.number(),
  ts: v.number(),
  userId: v.id("users"),
  projectId: v.optional(v.id("projects")),
  action: AuditAction,
  target: v.optional(AuditTarget),
  data: v.optional(AuditData),
});

export const RateLimitDoc = v.object({
  _id: v.id("rateLimits"),
  _creationTime: v.number(),
  key: v.string(),
  windowStart: v.number(),
  count: v.number(),
});

export const ProjectPolicyDoc = v.object({
  _id: v.id("projectPolicies"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  retentionDays: v.number(),
  gitWritePolicy: GitWritePolicy,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const ProjectDeletionTokenDoc = v.object({
  _id: v.id("projectDeletionTokens"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  tokenHash: v.string(),
  createdByUserId: v.id("users"),
  createdAt: v.number(),
  expiresAt: v.number(),
});

export const ProjectDeletionJobDoc = v.object({
  _id: v.id("projectDeletionJobs"),
  _creationTime: v.number(),
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
});
