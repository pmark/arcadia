/**
 * The blocker-kind remedy registry (#1284, Action one-click-clear-every-blocker-kind).
 *
 * One source for what the operator does about every stop the platform raises:
 * the escalation kinds written to `production_operator_escalations` and the
 * Red Alert triggers. The /todo card reads its label, consequence and control
 * from here, and `blockerRemedies.test.ts` fails the build when a kind the code
 * can emit has no entry, so a new blocker cannot be born without a remedy.
 *
 * Dashboard-importable: constants only. No commander, no database, no
 * transport; the dashboard's import graph must stay free of the container
 * audit transport. The registry grants nothing: a `clear` entry only names the
 * existing `production reset-repair-budget` semantics, and a `link` entry only
 * names a control that already exists on another surface.
 */

export type BlockerRemedyAction =
  /** One pinned button on /todo that runs `production reset-repair-budget` for the blocker's Action. */
  | "reset-repair-budget"
  /** The existing "Turn production Off" control on /production; this registry links to it and decides nothing. */
  | "turn-production-off"
  /** The item is answered by its own existing button on /todo (a Decision, review item or build packet). */
  | "answer-todo-item"
  /** Nothing to press: the worker tick or the review driver resolves it, and the card says what it waits on. */
  | "worker-resolves"
  /** The operator fixes the named input (a Plan, Project metadata, a candidate) through its governed path; no remote clear exists. */
  | "operator-step";

export interface BlockerRemedy {
  kind: string;
  /** The button or link label. */
  label: string;
  /** What pressing it (or following it) does, and what it never does. */
  consequence: string;
  remedyActionId: BlockerRemedyAction;
  /** Where the control lives. */
  surface: "todo" | "production" | "none";
  /** The route to open for a link entry; null when the control is on the card itself or there is none. */
  href: string | null;
  /** True only for the pinned one-button clears the card renders itself. */
  oneClick: boolean;
}

const OFF = "Turn production Off";
const OFF_CONSEQUENCE =
  "Opens /production, where Turn production Off asks for one confirmation. Off stops new admissions and fences unlaunched Actions; " +
  "committed work keeps running and nothing is killed or deleted. It changes no Grant, capacity or Decision.";
const CLEAR_CONSEQUENCE =
  "Clears this stop only: resets the Action's recorded repair attempts and unattended-review budget and drops this one blocker row, " +
  "exactly as `arcadia production reset-repair-budget` does. It grants no authority, changes no policy or Grant, and starts nothing; " +
  "the next worker tick admits the Action again, and a stop that is still true is raised again.";

const link = (kind: string, label: string, consequence: string, surface: "todo" | "production", href: string | null, remedyActionId: BlockerRemedyAction): BlockerRemedy =>
  ({ kind, label, consequence, remedyActionId, surface, href, oneClick: false });
const step = (kind: string, what: string): BlockerRemedy =>
  link(kind, "Fix the named input", `${what} Answer it through the governed path the card names; nothing is pressed from a phone, and the tick clears the row once the input holds.`, "todo", null, "operator-step");
const worker = (kind: string, what: string): BlockerRemedy =>
  link(kind, "Nothing to press", `${what} The worker tick re-evaluates it and clears the row itself.`, "todo", null, "worker-resolves");
const answer = (kind: string, label: string, what: string): BlockerRemedy =>
  link(kind, label, what, "todo", null, "answer-todo-item");
const clear = (kind: string, label: string): BlockerRemedy => ({
  kind,
  label,
  consequence: CLEAR_CONSEQUENCE,
  remedyActionId: "reset-repair-budget",
  surface: "todo",
  href: null,
  oneClick: true
});

/** Escalation kinds recorded in `production_operator_escalations`. */
export const ESCALATION_REMEDIES: Readonly<Record<string, BlockerRemedy>> = Object.freeze(
  Object.fromEntries(
    [
      clear("environment_wall", "Clear environment stop"),
      clear("budget_exhausted", "Clear token-ceiling stop"),
      step("repair_budget_exhausted", "Repeated launch attempts failed; repair the named error, then reset the budget with `arcadia production reset-repair-budget`."),
      step("no_validation_commands", "The Project declares no validation commands."),
      step("dependency_unresolved", "A depends_on entry names no known Action."),
      step("attempt_limit_exhausted", "The Action used its attempt limit."),
      step("attempt_retry_not_authorized", "A retry needs authority this Session does not hold."),
      step("planner_attempts_exhausted", "The planner used its attempts."),
      step("planning_required", "The Action needs a planning packet."),
      step("terminal_candidate_not_integrable", "A finished candidate cannot be integrated as it stands."),
      step("completion_settlement_not_in_candidate", "The completion was settled, but the candidate does not carry its settlement commit."),
      answer("operator_gate_pending", "Answer the Decision", "The Decision the card names is answered with its own button on /todo."),
      answer("planning_run_approval_pending", "Approve planning run", "The review item's own button on /todo queues the planning run; planning only."),
      answer("planning_artifact_validation_pending", "Retry planning", "The review item's own button on /todo creates a planning-retry approval."),
      answer("planning_artifact_acceptance_pending", "Accept plan", "The review item's own button on /todo accepts the validated plan; no Run starts."),
      answer("build_packet_approval_pending", "Approve build packet", "The packet's own button on /todo records the approval; nothing executes from it."),
      link("authority_adjacent_pr", "Merge on GitHub", "The worker never merges a pull request the blast-radius assessment marks authority-adjacent. Review it, then merge it on GitHub yourself; this card is a link only and grants no merge authority. The row clears once the worker records the PR merged.", "todo", null, "operator-step"),
      worker("awaiting_independent_verdicts", "The independent review and QA verdicts for the candidate's head are pending."),
      worker("verdict_readiness_failed", "The candidate could not be made ready for verdicts this tick."),
      worker("review_head_moved", "The candidate head moved after review started."),
      worker("review_pull_request_unavailable", "The candidate's pull request could not be read."),
      worker("review_paused_as_draft", "The candidate's pull request is a draft."),
      worker("required_checks_failed", "A required check failed on the candidate head."),
      worker("review_rate_limited", "The reviewer provider is rate limited."),
      step("required_checks_timeout", "Required checks did not finish in time; reset the review budget with `arcadia production reset-repair-budget` once they can."),
      step("review_budget_exhausted", "The unattended review used its per-head budget; reset it with `arcadia production reset-repair-budget`."),
      step("independent_verdict_failed", "An independent verdict failed on the candidate head; fix the finding or rerun the review."),
      step("review_repair_rounds_exhausted", "Three repair rounds for this Action failed independent review; read the findings on the draft PR, fix the candidate or rerun the review."),
      step("review_repair_gated", "A gate stopped the review repair loop (an authority-adjacent verdict or a checked-in authority path); read the findings on the draft PR and decide.")
    ].map((entry) => [entry.kind, entry] as const)
  )
);

/** Red Alert triggers (src/production/redAlerts.ts). */
export const RED_ALERT_REMEDIES: Readonly<Record<string, BlockerRemedy>> = Object.freeze(
  Object.fromEntries(
    [
      link("scope_successor_held", OFF, OFF_CONSEQUENCE, "production", "/production", "turn-production-off"),
      link("scope_pointer_mismatch", OFF, OFF_CONSEQUENCE, "production", "/production", "turn-production-off"),
      worker("admission_refused_consecutive", "Admissions were refused for repeated ticks; the refusal reason is on /production."),
      worker("session_stalled", "A Session stopped producing output."),
      worker("reconcile_failed", "Reconciling a Session's result failed."),
      worker("repair_budget_repeat", "The same Action exhausted its repair budget again.")
    ].map((entry) => [entry.kind, entry] as const)
  )
);

/** The remedy for an escalation kind or Red Alert trigger, or null when none is registered. */
export function blockerRemedyFor(kind: string): BlockerRemedy | null {
  return ESCALATION_REMEDIES[kind] ?? RED_ALERT_REMEDIES[kind] ?? null;
}

/** The kinds whose card carries the one-click pinned clear. */
export function isOneClickBlockerKind(kind: string): boolean {
  return blockerRemedyFor(kind)?.oneClick === true;
}
