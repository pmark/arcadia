import type { AskCommandData } from "../commands/ask.js";

/** What Arcadia heard an Ask as. `unclear` is a question it could not place; `none` is an Ask that created nothing. */
export type AskHeardType = "work" | "idea" | "answer" | "status" | "unclear" | "none";

/** The Ask types an operator can correct to by reply. `task` is added by ask-do-for-me-operator-tasks. */
export const ASK_CORRECTION_TYPES = ["work", "idea", "answer", "status"] as const;
export type AskCorrectionType = (typeof ASK_CORRECTION_TYPES)[number];

/** How the type was decided. Only deterministic rules exist today; `memo` and `model` are reserved by later Actions. */
export type AskHeardSource = "rule" | "memo" | "model";

export interface AskHeard {
  type: AskHeardType;
  confidence: string;
  source: AskHeardSource;
  /** What was created and where, in a few words. */
  created: string;
  /** The one receipt line: `Heard: <type> (<confidence>, <source>) -> <created> . wrong? reply type: ...`. */
  line: string;
}

/** The correction hint that closes every receipt line. */
export const ASK_HEARD_HINT = `wrong? reply type: ${ASK_CORRECTION_TYPES.join("|")}`;

type HeardInput = Pick<
  AskCommandData,
  | "intake"
  | "stewardship"
  | "resolvedIntent"
  | "result"
  | "workItem"
  | "project"
  | "projectSummary"
  | "projects"
  | "status"
  | "review"
  | "reviewItemId"
  | "decisionId"
  | "backBurnerItemId"
> & { decisionSlug?: string | null; suppressed?: AskCommandData["suppressed"] };

/**
 * The one line that opens every `arcadia ask` result. It says what the Ask was heard as and where the result went, and
 * it tells the operator how to fix a wrong guess with one reply. Deterministic: derived only from the result.
 */
export function buildAskHeard(data: HeardInput): AskHeard {
  const project =
    data.workItem?.project_name ?? data.intake.project?.name ?? data.project?.name ?? data.projectSummary?.name ?? null;
  const where = project ? `in ${project}` : "unscoped";
  const decision = data.decisionSlug ?? data.decisionId ?? data.reviewItemId ?? null;

  let type: AskHeardType;
  let created: string;
  if (data.suppressed) {
    type = "none";
    created = data.suppressed.reason === "acknowledgement"
      ? "nothing (acknowledgement)"
      : `nothing (already asked${data.suppressed.openQuestionId ? `: ${data.suppressed.openQuestionId}` : ""})`;
  } else if (data.resolvedIntent.intentId === "ReviewResponse" && data.reviewItemId) {
    type = "answer";
    created = `answer recorded on Decision ${decision}`;
  } else if (data.backBurnerItemId) {
    type = "idea";
    created = `Back Burner item ${data.backBurnerItemId} ${where}`;
  } else if (data.workItem) {
    type = "work";
    created = `Action ${data.workItem.id} ${where}${data.reviewItemId ? `, Decision ${decision}` : ""}`;
  } else if (data.reviewItemId) {
    const question = data.stewardship.recommendedExecutionPath === "Clarify First";
    type = question ? "unclear" : "work";
    created = question
      ? `question ${decision} in Clarify First ${where}`
      : `Decision ${decision} to review ${where}`;
  } else if (data.status || data.review || data.projectSummary || data.projects) {
    type = "status";
    created = "status shown (nothing created)";
  } else if (data.result.status === "acted") {
    type = "work";
    created = `${data.result.summary.replace(/\.$/, "")} ${where}`.trim();
  } else {
    type = "none";
    created = "nothing created";
  }

  const confidence = data.intake.confidenceLabel;
  const source: AskHeardSource = "rule";
  return {
    type,
    confidence,
    source,
    created,
    line: `Heard: ${type} (${confidence}, ${source}) -> ${created} . ${ASK_HEARD_HINT}`
  };
}
