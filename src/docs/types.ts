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
import type {
  ExecutionRequirement,
  ResolvedExecutionRequirement
} from "../execution/profiles.js";
import { slugify } from "../utils/slug.js";

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
  "reference",
  "continuation",
  "proposal",
  "template",
  "review"
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * Documents that opt into Arcadia's vocabulary but remain governed by their
 * own local protocol. They are recognized and reported, never dispatched.
 */
export const SUPPORTING_DOC_TYPES = ["continuation", "proposal", "template", "review"] as const;
export type SupportingDocType = (typeof SUPPORTING_DOC_TYPES)[number];

/** Plan states whose activation and ordering are owned by an external shim. */
export const SCOPED_OUT_PLAN_STATUSES = ["dormant", "proposed"] as const;
export type ScopedOutPlanStatus = (typeof SCOPED_OUT_PLAN_STATUSES)[number];

/** Plan lifecycle. Distinct from milestone status: a plan can be superseded. */
export const PLAN_STATUSES = ["draft", "active", "complete", "superseded"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Relative LLM-token exposure for a whole plan, never an exact forecast. */
export const TOKEN_IMPACTS = ["none", "small", "medium", "large", "xlarge"] as const;
export type TokenImpact = (typeof TOKEN_IMPACTS)[number];

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
  /**
   * The action to work on now. The continuation contract puts both pointers on
   * the project, which also makes two competing current actions structurally
   * impossible. A plan may still carry one for a project that has not adopted
   * the project-level pointer.
  */
  currentAction: string | null;
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
  /**
   * The milestone this action belongs to, when it is not the plan's own.
   *
   * A plan may span more than one milestone (Decision 0005). The alternative —
   * splitting the plan at the boundary — would sever every `depends_on` edge
   * across it, because a dependency may only name an action in the same plan.
   * Ordering is a dispatch constraint, so losing it at exactly the handoff most
   * likely to be gotten wrong is the worse trade.
   */
  milestone: string | null;
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
  /** Vendor-neutral execution requirements declared by the plan author. */
  execution: ExecutionRequirement | null;
  /** Complete effective requirements after expanding the named profile. */
  resolvedExecution: ResolvedExecutionRequirement | null;
}

export interface PlanQuestionDoc {
  id: string;
  question: string;
  gapType: GapType | null;
  /**
   * The decision document that answers this question, once one exists.
   *
   * Ingestion never deletes, so a question deleted from a plan leaves its
   * Decision open in the queue forever with nothing in any file explaining it.
   * Naming the decision resolves the question explicitly instead — the question
   * stays in the plan as the record of what was asked, and the decision holds
   * the answer.
   */
  decision: string | null;
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
  tokenImpact: TokenImpact;
  /** Human-readable boundary: what uses tokens, what does not, and how use is capped. */
  tokenBudget: string;
  /**
   * The model `arcadia go --apply --agent <x>` should launch the next session
   * with, e.g. `claude-sonnet-5` or `gpt-5.6-sol`. Free-form: validated by the
   * downstream agent CLI, not by Arcadia.
   *
   * Absent by default. `go` requires an explicit `--model` on the command line
   * when neither this nor a CLI override resolves one, rather than launching
   * an unpinned session silently.
   */
  recommendedModel: string | null;
  /** The paired effort/reasoning level, e.g. `high` or `standard`. Optional
   *  even when `recommendedModel` is set — omitted from the launch command
   *  when absent, letting the agent CLI use its own default. */
  recommendedReasoningEffort: string | null;
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

/** A recognized record that deliberately cannot participate in Arcadia dispatch. */
export interface ScopedOutDoc extends DocLocation {
  type: "scoped_out";
  sourceType: SupportingDocType | "plan";
  sourceStatus: ScopedOutPlanStatus | null;
  body: string;
}

export type ArcadiaDoc = ProjectDoc | PlanDoc | DecisionDoc | LogDoc | NarrativeDoc | ScopedOutDoc;

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

/** The inverse of {@link actionDocRef} — `null` for any other doc_ref shape. */
export function parseActionDocRef(docRef: string): { planSlug: string; actionId: string } | null {
  const match = /^plan\/([^#]+)#(.+)$/.exec(docRef);
  return match ? { planSlug: match[1], actionId: match[2] } : null;
}

export function planQuestionDocRef(planSlug: string, questionId: string): string {
  return `plan/${planSlug}?question=${questionId}`;
}

/**
 * A milestone a plan declares beyond its own. The plan's primary milestone keeps
 * the bare `plan/<slug>` ref it was ingested under, so adding this never
 * migrates an existing row.
 */
export function planMilestoneDocRef(planSlug: string, milestoneTitle: string): string {
  return `plan/${planSlug}?milestone=${slugifyMilestone(milestoneTitle)}`;
}

function slugifyMilestone(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "milestone"
  );
}

export function decisionDocRef(decisionSlug: string): string {
  return `decision/${decisionSlug}`;
}

/**
 * A mission Log entry is keyed by its whole `## YYYY-MM-DD — title` heading.
 *
 * Keying on the date alone reads like the safer choice — it would survive a
 * retitle, which is what doc_refs exist to do — but a real Log puts several
 * entries under one date routinely, and Arcadia's own has five on 2026-07-25.
 * A date-only key refuses most of that file, so the rarer cost is the right one
 * to pay: retitling an old entry forks a row, and two entries sharing a date do
 * not collide.
 *
 * Ordinal-within-date was the other candidate and is worse than both: entries
 * are prepended newest-first, so a new same-day entry would shift every ordinal
 * below it and silently rewrite rows that nobody edited.
 */
export function logEntryDocRef(logSlug: string, date: string, title: string): string {
  return `log/${logSlug}#${date}--${slugify(title)}`;
}
