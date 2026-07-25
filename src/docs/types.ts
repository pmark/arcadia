import type {
  ClarificationConfidence,
  ClarificationStatus,
  GapType,
  MilestoneStatus,
  ProjectStatus,
  WorkClassification,
  WorkItemStatus
} from "../domain/constants.js";
import type { OrientationEffort } from "../orientation/types.js";

/** The marker every managed document carries in its frontmatter. */
export const ARCADIA_DOC_MARKER = "arcadia";
export const ARCADIA_DOC_VERSION = "v1";

export const DOC_TYPES = [
  "project",
  "plan",
  "decision",
  "log",
  "architecture",
  "strategy",
  "reference"
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Plan lifecycle. Distinct from milestone status: a plan can be superseded. */
export const PLAN_STATUSES = ["draft", "active", "complete", "superseded"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const DECISION_DOC_STATUSES = ["open", "approved", "rejected", "deferred"] as const;
export type DecisionDocStatus = (typeof DECISION_DOC_STATUSES)[number];

/** Types whose frontmatter is parsed into rows; everything else is narrative. */
export const STRUCTURED_DOC_TYPES: DocType[] = ["project", "plan", "decision", "log"];

export interface DocLocation {
  /** Path relative to the project's repo root — what the operator sees in errors. */
  relativePath: string;
  absolutePath: string;
}

export interface DocValidationError {
  relativePath: string;
  /** Dotted path into the frontmatter, e.g. `actions[1].responsibility`. */
  field: string;
  message: string;
}

export interface ProjectDoc extends DocLocation {
  type: "project";
  slug: string;
  name: string;
  status: ProjectStatus;
  goal: string;
  outcome: string | null;
  /** Title of the current milestone, matched or created on ingest. */
  milestone: string | null;
  /**
   * Slug of the plan governing current work. Half of the authoritative work
   * pointer: without it a dispatched agent has no documented objective and
   * must fall back to guessing from commits or whichever task looks easiest,
   * which is exactly what the continuation contract forbids.
   */
  activePlan: string | null;
  updated: string;
  body: string;
}

export interface PlanActionDoc {
  id: string;
  title: string;
  status: WorkItemStatus;
  responsibility: WorkClassification;
  effort: OrientationEffort | null;
  nextAction: string | null;
  expectedArtifact: string | null;
  clarification: ClarificationStatus | null;
  gapType: GapType | null;
  question: string | null;
  confidence: ClarificationConfidence | null;
  source: string | null;
  dependsOn: string[];
  /**
   * Objective conditions that decide when this action is finished. Required on
   * the current action: "done" that only exists in someone's head is how an
   * agent declares victory on work nobody agreed was complete.
   */
  acceptanceCriteria: string[];
  /** Decision ids this action requires; a dispatched agent must read them first. */
  decisions: string[];
  /** Repository paths or URLs the action depends on for context. */
  references: string[];
}

export interface PlanQuestionDoc {
  id: string;
  question: string;
  gapType: GapType | null;
}

export interface PlanDoc extends DocLocation {
  type: "plan";
  slug: string;
  project: string;
  status: PlanStatus;
  milestone: string | null;
  /**
   * The one action in this plan that is the objective. The other half of the
   * work pointer; exactly one action may hold it across the whole project.
   */
  currentAction: string | null;
  updated: string;
  actions: PlanActionDoc[];
  questions: PlanQuestionDoc[];
  decisions: string[];
  body: string;
}

export interface DecisionDoc extends DocLocation {
  type: "decision";
  id: string;
  slug: string;
  project: string;
  plan: string | null;
  action: string | null;
  status: DecisionDocStatus;
  question: string;
  gapType: GapType | null;
  recommendation: string | null;
  confidence: ClarificationConfidence | null;
  decided: string | null;
  answer: string | null;
  updated: string;
  body: string;
}

export interface LogEntryDoc {
  /** `YYYY-MM-DD` from the entry heading — half of the entry's identity. */
  date: string;
  title: string;
  did: string;
  result: string;
  next: string | null;
  blockers: string | null;
}

export interface LogDoc extends DocLocation {
  type: "log";
  slug: string;
  project: string;
  updated: string;
  entries: LogEntryDoc[];
  body: string;
}

export interface NarrativeDoc extends DocLocation {
  type: "architecture" | "strategy" | "reference";
  slug: string;
  project: string;
  updated: string;
  body: string;
}

export type ArcadiaDoc = ProjectDoc | PlanDoc | DecisionDoc | LogDoc | NarrativeDoc;

/**
 * Stable external keys. Built only from identifiers the protocol promises never
 * change, so rewording a title updates a row rather than forking a new one.
 */
export function planDocRef(planSlug: string): string {
  return `plan/${planSlug}`;
}

export function actionDocRef(planSlug: string, actionId: string): string {
  return `plan/${planSlug}#${actionId}`;
}

export function planQuestionDocRef(planSlug: string, questionId: string): string {
  return `plan/${planSlug}?question=${questionId}`;
}

export function decisionDocRef(decisionSlug: string): string {
  return `decision/${decisionSlug}`;
}
