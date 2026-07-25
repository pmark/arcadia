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
export const QUEUES = ["inbox", "work_queue", "requires_review", "blocked"] as const;
export const WORK_CLASSIFICATIONS = ["autonomous", "codex", "requires_review", "blocked"] as const;
export const WORK_ITEM_STATUSES = ["open", "in_progress", "done", "blocked"] as const;
export const ARTIFACT_STATUSES = ["planned", "drafted", "ready", "published"] as const;
export const EXECUTOR_TYPES = ["deterministic", "codex_planning", "codex_build", "operator"] as const;
export const EXECUTION_PLAN_STATUSES = ["planned", "running", "completed", "requires_review", "failed"] as const;
export const EXECUTION_RUN_STATUSES = ["pending_execution", "running", "completed", "requires_review", "failed"] as const;
export const EXECUTION_STEP_STATUSES = ["pending", "running", "completed", "requires_review", "failed", "skipped"] as const;
export const ASK_REQUEST_STATUSES = ["planned", "requires_review", "failed"] as const;
export const APPROVAL_GATE_TYPES = [
  "credentials_required",
  "external_deployment",
  "publication",
  "destructive_filesystem_changes",
  "production_data_access",
  "financial_action",
  "merge_to_main",
  "send_email_or_messages"
] as const;
export const APPROVAL_GATE_STATUSES = ["pending", "approved", "rejected", "resolved"] as const;
export const CODEX_INVOCATION_PURPOSES = ["planning", "build"] as const;
export const CODEX_INVOCATION_STATUSES = ["packet_created", "running", "completed", "failed"] as const;
export const BACK_BURNER_STATUSES = ["incubating", "opportunistic", "promoted", "archived"] as const;
export const ASK_FEEDBACK_DECISIONS = ["up", "down"] as const;

/**
 * Where an Action sits in GTD's "clarify" step. `next_action` is NOT NULL, so a
 * captured Action always carries *some* string — usually a placeholder — which
 * makes the text itself useless as a signal. This column is the real source of
 * truth for "has anyone decided what to actually do here?".
 * See docs/plans/clarification-pass.md.
 */
export const CLARIFICATION_STATUSES = ["unclarified", "clarified", "question_open"] as const;

/**
 * The clarification rubric's gap taxonomy: when no concrete next action can be
 * named, exactly one of these says why. Each implies a different question shape
 * (a decision to make, an ask to send, a decomposition to approve, a definition
 * of done), which is what lets a clarification pass author one useful question
 * instead of a generic "needs more detail".
 */
export const GAP_TYPES = [
  "missing-decision",
  "missing-external-input",
  "missing-definition",
  "missing-success-criteria"
] as const;

/**
 * How far to trust a clarification verdict. Deliberately coarse, and distinct
 * from `review_items.confidence` (a REAL 0–1 score on a Decision) — this is the
 * rubric's own three-bucket label on an Action.
 */
export const CLARIFICATION_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

export const QUEUE_LABELS: Record<QueueName, string> = {
  inbox: "Inbox",
  work_queue: "Work Queue",
  requires_review: "Requires Review",
  blocked: "Blocked"
};

export const WORK_CLASSIFICATION_LABELS: Record<WorkClassification, string> = {
  autonomous: "Autonomous",
  codex: "Codex",
  requires_review: "Requires Review",
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
export type AskRequestStatus = (typeof ASK_REQUEST_STATUSES)[number];
export type ApprovalGateType = (typeof APPROVAL_GATE_TYPES)[number];
export type ApprovalGateStatus = (typeof APPROVAL_GATE_STATUSES)[number];
export type CodexInvocationPurpose = (typeof CODEX_INVOCATION_PURPOSES)[number];
export type CodexInvocationStatus = (typeof CODEX_INVOCATION_STATUSES)[number];
export type BackBurnerStatus = (typeof BACK_BURNER_STATUSES)[number];
export type AskFeedbackDecision = (typeof ASK_FEEDBACK_DECISIONS)[number];
export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number];
export type GapType = (typeof GAP_TYPES)[number];
export type ClarificationConfidence = (typeof CLARIFICATION_CONFIDENCE_LEVELS)[number];

export function isRequiresReviewValue(value: string | null | undefined): boolean {
  return value === "requires_review";
}

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
  if (isRequiresReviewValue(classification)) {
    return "requires_review";
  }

  if (classification === "blocked") {
    return "blocked";
  }

  return "work_queue";
}
