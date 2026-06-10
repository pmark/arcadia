export const WORKSPACE_FOLDERS = [
  "projects",
  "mission_logs",
  "artifacts",
  "skills",
  "prompts",
  "config",
  "database",
  "reports",
  "inbox"
] as const;

export const PROJECT_STATUSES = ["active", "paused", "incubating", "completed"] as const;
export const MILESTONE_STATUSES = ["active", "paused", "completed"] as const;
export const QUEUES = ["inbox", "work_queue", "needs_mark", "blocked"] as const;
export const WORK_CLASSIFICATIONS = ["autonomous", "codex", "needs_mark", "blocked"] as const;
export const WORK_ITEM_STATUSES = ["open", "in_progress", "done", "blocked"] as const;
export const ARTIFACT_STATUSES = ["planned", "drafted", "ready", "published"] as const;
export const EXECUTOR_TYPES = ["deterministic", "codex_planning", "codex_build", "mark"] as const;
export const EXECUTION_PLAN_STATUSES = ["planned", "running", "completed", "needs_mark", "failed"] as const;
export const EXECUTION_RUN_STATUSES = ["running", "completed", "needs_mark", "failed"] as const;
export const EXECUTION_STEP_STATUSES = ["pending", "running", "completed", "needs_mark", "failed", "skipped"] as const;

export const QUEUE_LABELS: Record<QueueName, string> = {
  inbox: "Inbox",
  work_queue: "Work Queue",
  needs_mark: "Needs Mark",
  blocked: "Blocked"
};

export const WORK_CLASSIFICATION_LABELS: Record<WorkClassification, string> = {
  autonomous: "Autonomous",
  codex: "Codex",
  needs_mark: "Needs Mark",
  blocked: "Blocked"
};

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export type QueueName = (typeof QUEUES)[number];
export type WorkClassification = (typeof WORK_CLASSIFICATIONS)[number];
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
export type ExecutorType = (typeof EXECUTOR_TYPES)[number];
export type ExecutionPlanStatus = (typeof EXECUTION_PLAN_STATUSES)[number];
export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];
export type ExecutionStepStatus = (typeof EXECUTION_STEP_STATUSES)[number];

export function assertAllowedValue<T extends string>(
  label: string,
  value: string,
  allowedValues: readonly T[]
): asserts value is T {
  if (!allowedValues.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(", ")}`);
  }
}

export function queueForWorkClassification(classification: WorkClassification): QueueName {
  if (classification === "needs_mark") {
    return "needs_mark";
  }

  if (classification === "blocked") {
    return "blocked";
  }

  return "work_queue";
}
