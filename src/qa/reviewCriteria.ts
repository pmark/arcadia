/**
 * The pull-request review criteria and the deterministic not-applicable
 * refusal's fixed wording, with no imports: src/qa/prReview.ts writes them
 * and src/production/reviewRepair.ts reads them. A leaf module, so loading
 * either never sees these constants half-initialized through an import cycle.
 */

export const QA_PR_REVIEW_CRITERIA = [
  { id: "correctness", name: "Correctness", description: "The change behaves as claimed and avoids material defects." },
  { id: "scope-fidelity", name: "Scope fidelity", description: "The change implements the approved scope without hidden expansion or omission." },
  { id: "approval-boundaries", name: "Approval boundaries", description: "The change preserves operator authority and does not cross gated boundaries." },
  { id: "managed-documents", name: "Managed documents", description: "Plans, Decisions, pointers, terminology, and operator guidance remain consistent." },
  { id: "hidden-consequences", name: "Hidden consequences", description: "Security, persistence, failure, idempotency, and compatibility consequences are explicit and safe." },
  { id: "operator-qa-plan", name: "Operator QA plan", description: "The operator-facing procedure is concrete, runnable, and states observable consequences." },
  { id: "tests-and-evidence", name: "Tests and evidence", description: "Supplied tests and runtime evidence substantiate the Candidate's material claims." }
] as const;

/**
 * The exact-head code review is the same evidence-only read-only executor as
 * QA, judging the patch as code rather than the Candidate against its scope.
 */
export const CODE_REVIEW_PR_CRITERIA = [
  { id: "correctness", name: "Correctness", description: "The changed code does what it claims for every input it accepts, with no logic, boundary, or type defect." },
  { id: "failure-handling", name: "Failure handling", description: "Errors, partial failures, retries, crashes, and restarts leave state consistent and idempotent." },
  { id: "state-and-concurrency", name: "State and concurrency", description: "Races, ordering, persistence, schema, and shared state are safe; no work can be lost or done twice." },
  { id: "security-and-authority", name: "Security and authority", description: "No credential exposure, injection, path escape, or broadened authority or approval boundary." },
  { id: "compatibility", name: "Compatibility", description: "Existing callers, stored data, configuration, and supported platforms (including Linux CI) keep working." },
  { id: "tests", name: "Tests", description: "Tests exercise the changed behavior and would fail if it regressed; not-applicable when the patch touches no executable or test file." }
] as const;

/**
 * The revision of Arcadia's deterministic review judgement: these criteria,
 * the not-applicable refusal wording, and the patch check that accepts or
 * refuses not-applicable claims (src/qa/patchApplicability.ts). It is hashed
 * into every independent verdict's criteria binding
 * (`independentVerdictReadiness`) and into the persisted review receipt's
 * evidence fingerprint (src/qa/prReview.ts), so bumping it makes every verdict
 * judged under an earlier revision non-current: the existing readiness path
 * re-reviews the candidate, and an old verdict, pass or fail, never stands.
 * Bump it whenever a change to either file can alter a verdict;
 * tests/judgement-revision.test.ts pins both files' content per revision.
 *
 * 1: implicit, every verdict before the revision existed.
 * 2: PR #1563 (#1555 Mission Log date-rollover bump, #1556
 *    retire-completion-draft attestation).
 */
export const JUDGEMENT_REVISION = 2;

export const REFUSED_NOT_APPLICABLE_FINDING_TITLE = "Refused not-applicable claim";
/** The deterministic check row that accepts or refuses the reviewer's not-applicable claims. */
export const NOT_APPLICABLE_CHECK_NAME = "Not-applicable claims";
/** The fixed recommendation of the refused not-applicable finding; the repair loop recognizes that deterministic finding by it. */
export const REFUSED_NOT_APPLICABLE_RECOMMENDATION = "Judge each refused criterion pass or fail against the patch, or report it not-checked; not-applicable is accepted only for a criterion the change demonstrably cannot affect.";
