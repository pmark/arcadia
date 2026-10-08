import type { ClarificationConfidence, GapType } from "../domain/constants.js";
import type { WorkItemSummary } from "../domain/types.js";
import type { ClarifyActor } from "./contract.js";
import type { GraderCandidate, GraderReceipt } from "./grader.js";
import type { ClarifyLintFinding } from "./lint.js";

/** A YES: a concrete next action was named. */
export interface ClarifiedVerdict {
  verdict: "clarified";
  nextAction: string;
  /**
   * How anyone would observe that the next action is finished. Required on a
   * clarified verdict: a next action with no done-condition is a wish.
   */
  doneCondition: string;
  actor: ClarifyActor;
  source: string;
  confidence: ClarificationConfidence;
}

/** A NO: exactly one gap, and exactly one question that unblocks it. */
export interface QuestionOpenVerdict {
  verdict: "question_open";
  gapType: GapType;
  question: string;
  /** missing-decision: the 2–4 criteria that matter. */
  criteria?: string[];
  /** missing-definition: proposed subtasks. A proposal only — never auto-created. */
  decomposition?: string[];
  /** missing-external-input: a draft of the ask. */
  draftAsk?: string;
  confidence?: ClarificationConfidence;
}

export type ClarifyVerdict = ClarifiedVerdict | QuestionOpenVerdict;

/** What a pass decided about one Action, before anything is written. */
export interface ClarifyEvaluation {
  workItem: WorkItemSummary;
  verdict: ClarifyVerdict;
  /**
   * Set when the deterministic lint rejected a clarified verdict and `verdict`
   * is the question it was downgraded to. Absent when the lint passed.
   */
  lintFindings?: ClarifyLintFinding[];
  /**
   * Set when the separate grader graded a clarified verdict that passed the
   * lint. `verdict` is then the pass (unchanged) or the question the grader's
   * single information request was turned into. `candidate` is what was graded.
   */
  grader?: { receipt: GraderReceipt; candidate: GraderCandidate };
}

/** What `--apply` actually changed, per Action. */
export interface ClarifyApplication {
  workItemId: string;
  clarificationStatus: "clarified" | "question_open";
  /** Set when a question was recorded as a real Decision. */
  decisionId?: string;
  decisionSlug?: string;
  /**
   * Proposed subtasks that were deliberately NOT created. Surfaced so the
   * operator can act on them, never written by this command.
   */
  proposedSubtasks?: string[];
  /** The `clarify.grader.verdict` event that holds this Action's grader receipt. */
  graderEventId?: string;
}

/**
 * How the orchestrator reaches a verdict. Injectable so tests can run the whole
 * pass deterministically and offline against a stub, and so a future `--engine`
 * escape hatch has somewhere to plug in.
 */
export type ClarifyEvaluator = (workItem: WorkItemSummary) => Promise<ClarifyVerdict>;
