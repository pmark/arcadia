/**
 * Whether a plan's declared acceptance criterion holds against a finished
 * Run's output, checked mechanically.
 *
 * There is no judge here, deliberately: `docs/plans/dispatch-contract-
 * enforcement.md`'s `criteria-judgment` question — whether local Intelligence
 * should rule on criteria a script cannot — is still open, not assumed. A
 * criterion is free-text English a human wrote ("The migration is
 * idempotent."); nothing here can verify that claim is true, only whether the
 * Artifact ever addressed the topic at all. So the honest ceiling for a text
 * check is a negative: strong absence of the criterion's own words is real
 * evidence of "unmet". Presence is not evidence of "met" — an Artifact that
 * mentions a topic has not thereby satisfied it — so `met` is not produced by
 * this checker at all today. It stays part of the type for when a stronger
 * signal exists to justify it (a self-reported checklist, a validation
 * command result), rather than being invented now.
 */
export type AcceptanceCriterionStatus = "met" | "unmet" | "unchecked";

export interface AcceptanceCriterionResult {
  /** The plan author's own words, verbatim — never paraphrased. */
  criterion: string;
  status: AcceptanceCriterionStatus;
  reason: string;
}

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "always", "before", "being", "cannot",
  "could", "declared", "every", "never", "other", "should", "their", "there",
  "these", "thing", "those", "under", "using", "which", "while", "with", "would"
]);

/**
 * Evaluate every declared criterion against one Artifact's text.
 *
 * `criteria` order is preserved so the report reads in the plan author's own
 * order, not an evaluator-chosen one.
 */
export function evaluateAcceptanceCriteria(
  criteria: string[],
  artifactText: string
): AcceptanceCriterionResult[] {
  return criteria.map((criterion) => evaluateOne(criterion, artifactText));
}

function evaluateOne(criterion: string, artifactText: string): AcceptanceCriterionResult {
  const terms = salientTerms(criterion);
  if (terms.length === 0) {
    return {
      criterion,
      status: "unchecked",
      reason: "The criterion has no distinctive terms a script can search for; a human must judge it."
    };
  }

  const present = terms.filter((term) => containsLoose(artifactText, term));
  if (present.length === 0) {
    return {
      criterion,
      status: "unmet",
      reason: `None of this criterion's key terms (${terms.join(", ")}) appear anywhere in the accepted Artifact.`
    };
  }

  return {
    criterion,
    status: "unchecked",
    reason: "The criterion's terms appear in the Artifact, but whether it is actually satisfied cannot be verified mechanically; confirm by reading the Artifact."
  };
}

/**
 * A short, human-readable block for a Decision's note — the plan author's
 * words, one line per criterion, with the mechanical reason attached so
 * "unchecked" never reads like silent approval.
 */
export function renderAcceptanceCriteriaReport(results: AcceptanceCriterionResult[]): string {
  if (results.length === 0) {
    return "";
  }
  const lines = results.map((result) => `- ${result.status}: "${result.criterion}" — ${result.reason}`);
  return ["Acceptance criteria:", ...lines].join("\n");
}

function salientTerms(criterion: string): string[] {
  const quoted = [...criterion.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const tokens = criterion
    .split(/[^A-Za-z0-9]+/g)
    .filter((token) => token.length >= 5 && !STOP_WORDS.has(token.toLowerCase()));
  return [...new Set([...quoted, ...tokens].map((term) => term.trim()).filter((term) => term.length >= 3))];
}

function containsLoose(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
