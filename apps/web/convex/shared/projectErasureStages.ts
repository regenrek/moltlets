export const PROJECT_DELETION_STAGES = [
  "runEvents",
  "runs",
  "providers",
  "projectConfigs",
  "hosts",
  "gateways",
  "secretWiring",
  "jobs",
  "runnerCommandResultBlobs",
  "runnerCommandResults",
  "runnerTokens",
  "runners",
  "projectMembers",
  "auditLogs",
  "projectPolicies",
  "projectDeletionTokens",
  "project",
  "done",
] as const;

export type ProjectDeletionStageValue = (typeof PROJECT_DELETION_STAGES)[number];
