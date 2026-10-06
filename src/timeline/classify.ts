import type { WorkKind } from "./schema.js";

/**
 * The controlled `workKind` taxonomy: every source kind maps to exactly one.
 *
 *   plan-design  shaping what will be done: planning, Actions created or split, plan critique roles
 *   implement    producing the change: development Sessions, agent commits
 *   review       judging someone else's change: code review, critique, critic identities
 *   verify       proving it works: QA, validation, tests
 *   integrate    landing it: pushes, PRs, merges, the base branch moving
 *   govern       recording authority: Ask settlements, Decisions, pointer moves, Action completion
 *   operate      running the machine: production policy, admissions, launches, operator scripts, escalations
 *   observe      signals about the work rather than the work: notifications, pings, packets, source errors
 *
 * A kind not in this table is `unknown`, which is what the stream shows; the
 * table is the one place a new kind is classified.
 */
export const WORK_KIND_BY_EVENT_KIND: Readonly<Record<string, WorkKind>> = {
  // git
  "git.commit": "implement",
  "git.merge": "integrate",
  "git.worktree.created": "implement",
  // Only "Git ran here": any index refresh sets it, including other tools' read-only scans.
  "git.worktree.touched": "observe",
  "git.worktree.integrated": "integrate",
  // governed records (derived from commits that changed checked-in records)
  "record.project.plan_activated": "govern",
  "record.project.pointer_moved": "govern",
  "record.project.milestone_changed": "govern",
  "record.project.status_changed": "govern",
  "record.plan.created": "plan-design",
  "record.plan.status_changed": "govern",
  "record.plan.pointer_moved": "govern",
  "record.action.created": "plan-design",
  "record.action.status_changed": "govern",
  "record.action.done": "govern",
  "record.decision.raised": "govern",
  "record.decision.answered": "govern",
  "record.log.appended": "observe",
  "record.proposal.added": "plan-design",
  // sessions
  "session.prepared": "operate",
  "session.started": "implement",
  "session.ended": "implement",
  "session.stalled": "operate",
  "session.exit_recorded": "implement",
  "role.planner": "plan-design",
  "role.critique": "review",
  "role.development": "implement",
  "role.code-review": "review",
  "role.qa": "verify",
  // asks
  "ask.proposed": "govern",
  "ask.settled": "govern",
  "ask.rejected": "govern",
  // decisions and review items
  "decision.review_item.opened": "govern",
  "decision.review_item.decided": "govern",
  "decision.deferred": "govern",
  // events table
  "event.base_branch_advanced": "integrate",
  "event.packet_approved": "govern",
  "event.session_stalled": "operate",
  "event.orientation": "observe",
  "event.operator_reply": "govern",
  // production
  "production.policy.activate": "operate",
  "production.policy.deactivate": "operate",
  "production.admission.issued": "operate",
  "production.admission.committed": "operate",
  "production.admission.released": "operate",
  "production.admission.fenced": "operate",
  "production.escalation": "operate",
  "production.launch_refused": "operate",
  "production.repair_attempt": "operate",
  "production.review_step.pushed": "integrate",
  "production.review_step.ready": "review",
  "production.preservation": "integrate",
  // queue and pointer receipts
  "queue.arranged": "govern",
  "queue.pointer_moved": "govern",
  // operator scripts
  "operator-script.run": "operate",
  // pings and notifications
  "ping.created": "observe",
  "ping.sent": "observe",
  "notification.settlement_sent": "observe",
  // pull requests
  "pr.opened": "integrate",
  "pr.merged": "integrate",
  "pr.closed": "integrate",
  // the stream itself
  "source_error": "observe",
  "source.truncated": "observe"
};

export function workKindFor(kind: string): WorkKind {
  return WORK_KIND_BY_EVENT_KIND[kind] ?? "unknown";
}

/**
 * A plain commit's kind of work. Order matters: a critic identity is review
 * whatever it touched; then merges; then the conventional-commit prefix; then
 * the default for a commit, implement.
 */
export function classifyCommit(input: {
  subject: string;
  parentCount: number;
  actorRole: string | null;
  committerIsGitHub: boolean;
}): { workKind: WorkKind; provenance: string } {
  if (input.actorRole === "critic") return { workKind: "review", provenance: "critic identity role" };
  if (input.parentCount > 1) return { workKind: "integrate", provenance: "merge commit (more than one parent)" };
  if (input.committerIsGitHub && /\(#\d+\)\s*$/.test(input.subject)) {
    return { workKind: "integrate", provenance: "GitHub squash merge (committer GitHub, subject ends with (#N))" };
  }
  const prefix = /^(\w+)(\([^)]*\))?!?:/.exec(input.subject)?.[1]?.toLowerCase();
  if (prefix === "test") return { workKind: "verify", provenance: "conventional-commit prefix test:" };
  if (prefix === "review") return { workKind: "review", provenance: "conventional-commit prefix review:" };
  if (/^chore\(arcadia\): (settle|point at|propose|record)/.test(input.subject)) {
    return { workKind: "govern", provenance: "Arcadia governed-record commit subject" };
  }
  return { workKind: "implement", provenance: prefix ? `conventional-commit prefix ${prefix}: (default implement)` : "commit (default implement)" };
}

/** An Agent Ask's intent says what kind of work its settlement records. */
export function workKindForAskIntent(intent: string | null | undefined): WorkKind {
  switch (intent) {
    case "plan":
    case "split":
    case "action":
    case "milestone":
    case "project_update":
      return "plan-design";
    case "log":
      return "observe";
    case "complete":
    case "decision":
    case "proposal":
    case "auto":
      return "govern";
    default:
      return "govern";
  }
}

/** Review items are approval gates; the question they ask names their kind. */
export function workKindForReviewItem(decisionNeeded: string): { workKind: WorkKind; provenance: string } {
  if (/^QA (pass|fail)\b/i.test(decisionNeeded)) return { workKind: "verify", provenance: "review item asks a QA verdict" };
  if (/^Code review\b/i.test(decisionNeeded)) return { workKind: "review", provenance: "review item asks a code-review verdict" };
  return { workKind: "govern", provenance: "review item is an approval gate" };
}
