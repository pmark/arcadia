import type Database from "better-sqlite3";
import { discoverDocs } from "../docs/discover.js";
import type { PlanActionDoc } from "../docs/types.js";
import { isAncestor, isPatchEquivalent, resolveBaseBranch } from "../git/worktrees.js";
import { canonicalPath, getSession, type AgentSession } from "../sessions/index.js";
import { developedForSupersededInput } from "../sessions/roleLineage.js";
import { runHostCommand, type QaPrReviewDependencies } from "../qa/prReview.js";
import { redactSecrets } from "../sessions/validationEvidence.js";
import { REVIEW_REPAIR_ESCALATIONS, REVIEW_REPAIR_ROUNDS_EXHAUSTED } from "./reviewRepair.js";

/**
 * The one definition of "a terminal Session candidate that terminal recovery
 * still owns", shared by the tick's `recoverTerminalHandoff` and the
 * scheduler's pointer hold (Issue #1512) so the two can never disagree: the
 * scheduler holds the pointer exactly while recovery would act on the
 * candidate, and never for one recovery ignores.
 *
 * A Session qualifies when its worker-recorded exit (`worker-tick-reconcile-*`)
 * is an accepted completion, or an unsuperseded `incomplete_resumable` exit
 * whose candidate already carries the Action's recorded completion settlement
 * (Issue #994); its Action is not done in the base checkout; its branch has
 * not landed on the base branch; and it was not developed for a superseded
 * input of its Action (Issue #1158). An accepted exit a review repair Session
 * superseded (src/production/reviewRepair.ts) no longer qualifies: the repair
 * owns the Action now. Newest exit first. Read-only.
 */

/**
 * Operator decision 2026-10-21 (Release Manager session): an Action whose
 * review repair stopped for the operator (`review_repair_rounds_exhausted`,
 * `review_repair_gated`, `review_repair_gate_defect`) is "held": its candidate stays preserved and
 * un-integrated until the operator acts, and it must not block admission of
 * in-scope Actions that do not depend on it. Returns that open escalation, or
 * null. Read-only; a missing table answers null.
 *
 * Issue #1929: the stop binds only the Action input its candidate was
 * developed for. Once the Action's input (criteria or packet) differs from
 * that candidate's (`developedForSupersededInput`), the escalation no longer
 * holds the Action and a fresh attempt may be admitted. This releases every
 * review repair stop kind alike, gated ones included (an authority-adjacent
 * verdict, a Decision 0098 gate-list path, exhausted draft/comment notifies):
 * the stop judged the old candidate, and the new candidate is judged afresh by
 * the same gates. A production epoch change alone never releases a stop: with
 * the same input the development lineage would refuse the fresh attempt, and
 * that refusal would overwrite the held row and stall independent Actions.
 * The escalation row and its repair record are kept for history, never
 * rewritten, and no consumed allowance is reset.
 */
export function operatorHeldEscalation(db: Database.Database, actionKey: string, context: RepairStopContext = {}): { kind: string; firstDetectedAt: string } | null {
  const state = reviewRepairEscalationState(db, actionKey, context);
  if (state) return state.staleReason === null ? { kind: state.kind, firstDetectedAt: state.firstDetectedAt } : null;
  return actionLocalHold(db, actionKey);
}

/**
 * Decision 0223 (D1, answer A): the Action-local stop classes that hold their
 * Action besides the review-repair kinds. `completion_loopback_denied`
 * (Issue #2519) and `completion_validation_unavailable` (Issue #1613, the
 * validation-environment hold) are Action-local by construction: each names
 * one candidate's pre-acceptance validation. Each held kind keeps its
 * candidate, counters and evidence, and its dependents stay unready. Global,
 * unknown or shared failures (sign-in, authority, STOP, storage, custody,
 * environment wall) are deliberately absent: they still stop the scope.
 */
export const ACTION_LOCAL_HELD_ESCALATIONS: ReadonlySet<string> = new Set(["completion_loopback_denied", "completion_validation_unavailable"]);

/** The kind that two classes share: held only when its recorded cause is Action-local (see `repairBudgetCauseIsActionLocal`). */
export const REPAIR_BUDGET_EXHAUSTED_KIND = "repair_budget_exhausted";

/**
 * Who spent an Action's repair attempts, named by the code that records each
 * attempt (`recordRepairAttempt`), never inferred from the escalation kind or
 * the error text. `action_local`: the Action's own resumed Session exited
 * incomplete without changing its candidate. `shared`: a launch, tmux,
 * worktree or draft-retirement failure, or anything else. Callers that name no
 * cause record `shared`.
 */
export type RepairBudgetCause = "action_local" | "shared";

/**
 * True only when every recorded attempt was explicitly Action-local. Fails
 * safe: a missing row, a legacy row (no local count), one shared attempt or a
 * read error answers false, which keeps the stop run-wide.
 */
export function repairBudgetCauseIsActionLocal(db: Database.Database, actionKey: string): boolean {
  try {
    const row = db.prepare("SELECT attempts, local_attempts FROM production_repair_attempts WHERE action_key = ?").get(actionKey) as { attempts: number; local_attempts: number } | undefined;
    return !!row && row.attempts > 0 && row.local_attempts === row.attempts;
  } catch { return false; }
}

/** Whether an escalation of this kind on this Action is an Action-local hold (held, not run-stopping). */
export function isActionLocalHeldKind(db: Database.Database, actionKey: string, kind: string): boolean {
  return ACTION_LOCAL_HELD_ESCALATIONS.has(kind) || (kind === REPAIR_BUDGET_EXHAUSTED_KIND && repairBudgetCauseIsActionLocal(db, actionKey));
}

/** This Action's open escalation when it is one of the Action-local held classes, or null. Read-only; a missing table answers null. */
function actionLocalHold(db: Database.Database, actionKey: string): { kind: string; firstDetectedAt: string } | null {
  let row: { kind: string; first_detected_at: string } | undefined;
  try {
    row = db.prepare("SELECT kind, first_detected_at FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as { kind: string; first_detected_at: string } | undefined;
  } catch { return null; }
  return row && isActionLocalHeldKind(db, actionKey, row.kind) ? { kind: row.kind, firstDetectedAt: row.first_detected_at } : null;
}

/** What a caller knows about the Action now, so the staleness check need not rediscover it. */
export interface RepairStopContext {
  /** The checked-in repository, read only when `action` is not supplied. */
  repoRoot?: string | null;
  /** The Plan the Action is read from; defaults to the stopped candidate Session's Plan. */
  planSlug?: string | null;
  /** The Action as the base checkout defines it now. */
  action?: PlanActionDoc;
}

/**
 * This Action's open review repair escalation, with the reason it no longer
 * binds (`staleReason`), or null when there is none. A stop whose repair
 * record cannot be found, or whose staleness cannot be judged, stays binding
 * (fail closed). Read-only.
 */
export function reviewRepairEscalationState(
  db: Database.Database,
  actionKey: string,
  context: RepairStopContext = {}
): { kind: string; firstDetectedAt: string; staleReason: string | null } | null {
  let row: { kind: string; first_detected_at: string } | undefined;
  try {
    row = db.prepare("SELECT kind, first_detected_at FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as { kind: string; first_detected_at: string } | undefined;
  } catch { return null; }
  if (!row || !REVIEW_REPAIR_ESCALATIONS.has(row.kind)) return null;
  const stop = latestRepairStop(db, actionKey, row.kind === REVIEW_REPAIR_ROUNDS_EXHAUSTED ? "escalated" : "gated");
  return { kind: row.kind, firstDetectedAt: row.first_detected_at, staleReason: stop ? staleRepairStopReason(db, actionKey, stop, context) : null };
}

/** The fields of a stopped `production_review_repairs` row the staleness check reads. */
interface RepairStop { failed_session_id: string; outcome: string }

function latestRepairStop(db: Database.Database, actionKey: string, outcome: "escalated" | "gated"): RepairStop | null {
  try {
    return (db.prepare(`SELECT failed_session_id, outcome FROM production_review_repairs
      WHERE action_key = ? AND outcome = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(actionKey, outcome) as RepairStop | undefined) ?? null;
  } catch { return null; }
}

/**
 * Why a stopped repair no longer binds its Action, or null while it does:
 * only when the stopped candidate was developed for a superseded input of the
 * Action (Issue #1158's test). Anything unjudgeable answers null (fail closed).
 */
function staleRepairStopReason(db: Database.Database, actionKey: string, stop: RepairStop, context: RepairStopContext): string | null {
  const slash = actionKey.indexOf("/");
  if (slash < 1) return null;
  const projectSlug = actionKey.slice(0, slash);
  const actionId = actionKey.slice(slash + 1);
  let planSlug = context.planSlug ?? null;
  if (!planSlug) {
    try { planSlug = getSession(db, stop.failed_session_id)?.plan_slug ?? null; } catch { planSlug = null; }
  }
  if (!planSlug) return null;
  let action = context.action;
  if (!action && context.repoRoot) {
    try {
      const plan = discoverDocs(context.repoRoot).docs.find((doc) => doc.type === "plan" && doc.project === projectSlug && doc.slug === planSlug);
      action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === actionId) : undefined;
    } catch { action = undefined; }
  }
  if (!action || action.id !== actionId) return null;
  try {
    return developedForSupersededInput(db, { id: stop.failed_session_id, project_slug: projectSlug, plan_slug: planSlug, action_id: actionId }, action)
      ? "its stopped candidate was developed for a superseded input of the Action (criteria or packet changed)"
      : null;
  } catch { return null; }
}

export interface PendingTerminalCandidates {
  baseBranch: string;
  /** Qualifying Sessions, newest exit first. */
  pending: AgentSession[];
}

export function listPendingTerminalCandidates(
  db: Database.Database,
  repoRoot: string,
  projectSlug: string,
  options: {
    /** Only this Action's exits (filtered in SQL). Recovery passes none. */
    actionId?: string;
    /** Throw, rather than return null, when the base branch cannot be resolved. */
    strict?: boolean;
    onSuperseded?: (session: AgentSession, action: PlanActionDoc | undefined) => void;
  } = {}
): PendingTerminalCandidates | null {
  const hasExits = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_exit_receipts'").get();
  if (!hasExits) return null;
  const actionId = options.actionId ?? null;
  const exits = db.prepare(`SELECT r.session_id, r.outcome, r.evidence_json FROM session_exit_receipts r
    JOIN agent_sessions s ON s.id = r.session_id
    WHERE s.repository_path = ? AND s.project_slug = ?
      AND (? IS NULL OR s.action_id = ?)
      AND r.superseded_by_session_id IS NULL AND r.outcome IN ('accepted_completion', 'incomplete_resumable')
      AND r.request_id = ('worker-tick-reconcile-' || r.session_id)
    ORDER BY r.created_at DESC, r.rowid DESC`).all(canonicalPath(repoRoot), projectSlug, actionId, actionId) as Array<{ session_id: string; outcome: string; evidence_json: string | null }>;
  if (exits.length === 0) return null;

  let baseBranch: string;
  try {
    baseBranch = resolveBaseBranch(repoRoot);
  } catch (error) {
    if (options.strict) throw error;
    return null;
  }
  const docs = discoverDocs(repoRoot).docs;
  const basePlans = docs.filter((doc) => doc.type === "plan");
  // Recovery (no `actionId`) leaves a held Action's candidate to the operator
  // once the pointer has moved past it, so it neither refuses the handoff of
  // the Action now running nor makes two candidates "ambiguous". While the
  // pointer still names it, it stays the candidate recovery refuses today.
  const pointer = actionId === null ? docs.find((doc) => doc.type === "project" && doc.slug === projectSlug) : undefined;
  const pointerAction = pointer?.type === "project" ? pointer.currentAction : null;
  const pending: AgentSession[] = [];
  for (const exit of exits) {
    const session = getSession(db, exit.session_id);
    if (!session) continue;
    // Issue #1615: a settled completion the host refused is the operator's, never recovery's to integrate.
    if (exit.evidence_json?.includes("completionSettlementNotInCandidate")) continue;
    const plan = basePlans.find((doc) => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug);
    const action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === session.action_id) : undefined;
    if (actionId === null && session.action_id !== pointerAction
      && operatorHeldEscalation(db, `${session.project_slug}/${session.action_id}`, { planSlug: session.plan_slug, action })) continue;
    if (action?.status === "done") continue;
    if (exit.outcome !== "accepted_completion" && !latestCandidateSettlementCommit(db, session, repoRoot)) continue;
    if (isAncestor(repoRoot, session.branch, baseBranch) || isPatchEquivalent(repoRoot, baseBranch, session.branch)) continue;
    if (developedForSupersededInput(db, session, action)) {
      options.onSuperseded?.(session, action);
      continue;
    }
    pending.push(session);
  }
  return { baseBranch, pending };
}

export type TerminalCandidateCheck =
  | { kind: "none" }
  | { kind: "pending"; session: AgentSession }
  /** The check could not answer (Git or store failure); callers must hold, never treat it as "none". */
  | { kind: "unknown"; reason: string };

/**
 * The newest pending terminal candidate (per `listPendingTerminalCandidates`,
 * filtered to `actionId`) for the pointer hold. Fails closed: a failure to
 * answer is `unknown`, which holds the pointer exactly like a pending
 * candidate, so a Git or store fault never lets the scheduler commit a
 * pointer move under work recovery may still own.
 */
export function pendingTerminalCandidateFor(
  db: Database.Database,
  repoRoot: string,
  projectSlug: string,
  actionId: string
): TerminalCandidateCheck {
  try {
    const session = listPendingTerminalCandidates(db, repoRoot, projectSlug, { actionId, strict: true })?.pending[0];
    return session ? { kind: "pending", session } : { kind: "none" };
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The newest documents commit any applied completion settlement recorded on
 * this Session's branch (not yet on the base): for the remedy text, and to
 * recognise an unfinished exit whose candidate already settled its Action.
 */
export function latestCandidateSettlementCommit(db: Database.Database, session: AgentSession, repoRoot: string): string | null {
  try {
    const baseBranch = resolveBaseBranch(repoRoot);
    const rows = db.prepare(`SELECT s.receipt_json, p.proposal_json FROM agent_ask_settlements s
      JOIN agent_ask_proposals p ON p.id = s.proposal_id
      WHERE s.project_slug = ? AND s.disposition = 'accepted' AND p.intent_kind = 'complete'
      ORDER BY s.created_at DESC LIMIT 20`)
      .all(session.project_slug) as Array<{ receipt_json: string; proposal_json: string }>;
    const targets = new Set([`action/${session.action_id}`, `plan/${session.plan_slug}#${session.action_id}`]);
    for (const row of rows) {
      const receipt = JSON.parse(row.receipt_json) as { applied?: boolean; documentsCommit?: string | null };
      const targetRef = (JSON.parse(row.proposal_json) as { normalized?: { targetRef?: string | null } }).normalized?.targetRef;
      if (!receipt.applied || !receipt.documentsCommit || !targetRef || !targets.has(targetRef)) continue;
      // An earlier attempt's settlement already on the base is not this candidate's.
      if (isAncestor(session.worktree_path, receipt.documentsCommit, baseBranch)) continue;
      if (isAncestor(session.worktree_path, receipt.documentsCommit, "HEAD")) return receipt.documentsCommit;
    }
  } catch { /* the remedy then names no settlement commit */ }
  return null;
}

/** At most this many `gh issue create` attempts per park episode, one per tick (issue #2629). */
export const MAX_PARK_ISSUE_ATTEMPTS = 3;
const parkIssueMarker = (actionKey: string, episode: string) => `repair-budget-parked:${actionKey}:${episode}`;

function ensureRepairParkIssueTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_repair_park_issues (
      action_key TEXT NOT NULL,
      episode TEXT NOT NULL,
      issue_url TEXT,
      issue_attempts INTEGER NOT NULL DEFAULT 0,
      issue_last_attempt_at TEXT,
      issue_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (action_key, episode)
    );
  `);
}

const oneLinePark = (text: string, limit = 600) => {
  const flat = redactSecrets(text).replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().replaceAll("@", "@​");
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}...`;
};

/**
 * Issue #2629 (Decision 0223 A): a parked Action records a GitHub Issue naming its
 * revival trigger. For each Action of the Project held by an open
 * `repair_budget_exhausted` row whose recorded cause is Action-local, file ONE Issue
 * per park episode (the escalation's `first_detected_at`) through the injected runner.
 * Persisted per (Action, episode) so a later tick files nothing; an attempt that failed
 * is retried at most once per tick and {@link MAX_PARK_ISSUE_ATTEMPTS} in all, after a
 * body-marker search so a crash after filing adopts the Issue instead of duplicating it.
 * Never files for a global-cause exhaustion, another kind, or an Action with no open
 * hold. A failure only logs: the park outcome, counters, escalation and tick result are
 * untouched. Must be called outside any database transaction callback. Never throws.
 */
export function recordRepairBudgetParkIssues(db: Database.Database, input: {
  projectSlug: string; repoRoot: string; now: Date; log?: (message: string) => void;
  runCommand?: QaPrReviewDependencies["runCommand"];
  /** Injectable Plan check (tests); defaults to the real checked-in Plan read. */
  actionStillOpen?: (repoRoot: string, projectSlug: string, actionKey: string) => boolean;
}): void {
  try {
    const rows = db.prepare("SELECT action_key, message, first_detected_at FROM production_operator_escalations WHERE kind = ? AND substr(action_key, 1, ?) = ?")
      .all(REPAIR_BUDGET_EXHAUSTED_KIND, input.projectSlug.length + 1, `${input.projectSlug}/`) as Array<{ action_key: string; message: string; first_detected_at: string }>;
    for (const row of rows) {
      if (!repairBudgetCauseIsActionLocal(db, row.action_key)) continue;
      // The cheap persisted guards run first inside fileParkIssue; the Plan read (doc discovery) only when an attempt is due.
      fileParkIssue(db, { ...input, actionKey: row.action_key, episode: row.first_detected_at, message: row.message,
        isOpen: () => (input.actionStillOpen ?? actionStillOpen)(input.repoRoot, input.projectSlug, row.action_key) });
    }
  } catch (thrown) {
    input.log?.(`Recording repair-budget park Issues for ${input.projectSlug} failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }
}

/** Whether the checked-in Plan still lists the Action as open or in progress. Fails closed (false) when it cannot be read. */
function actionStillOpen(repoRoot: string, projectSlug: string, actionKey: string): boolean {
  const actionId = actionKey.slice(projectSlug.length + 1);
  try {
    const statuses = discoverDocs(repoRoot).docs.flatMap((doc) => doc.type === "plan" && doc.project === projectSlug
      ? doc.actions.filter((entry) => entry.id === actionId).map((entry) => entry.status) : []);
    return statuses.length > 0 && statuses.every((status) => status === "open" || status === "in_progress");
  } catch { return false; }
}

function fileParkIssue(db: Database.Database, input: {
  actionKey: string; episode: string; message: string; repoRoot: string; now: Date; log?: (message: string) => void;
  runCommand?: QaPrReviewDependencies["runCommand"];
  isOpen: () => boolean;
}): void {
  const { actionKey, episode } = input;
  ensureRepairParkIssueTable(db);
  const at = input.now.toISOString();
  const read = () => db.prepare("SELECT issue_url, issue_attempts, issue_last_attempt_at FROM production_repair_park_issues WHERE action_key = ? AND episode = ?").get(actionKey, episode) as
    { issue_url: string | null; issue_attempts: number; issue_last_attempt_at: string | null } | undefined;
  const settled = (r: ReturnType<typeof read>) => r !== undefined && (r.issue_url !== null || r.issue_attempts >= MAX_PARK_ISSUE_ATTEMPTS || r.issue_last_attempt_at === at);
  // Cheap guards first: a recorded Issue, exhausted attempts or this tick's attempt end here, before any doc discovery or gh call.
  if (settled(read())) return;
  // A stale row for an Action that is done, gone or no longer open in the checked-in Plan is not a park.
  if (!input.isOpen()) return;
  db.prepare("INSERT INTO production_repair_park_issues (action_key, episode, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(action_key, episode) DO NOTHING").run(actionKey, episode, at, at);
  const row = read()!;
  db.prepare("UPDATE production_repair_park_issues SET issue_attempts = issue_attempts + 1, issue_last_attempt_at = ?, updated_at = ? WHERE action_key = ? AND episode = ?").run(at, at, actionKey, episode);
  let url: string | null = null;
  let error: string | null = null;
  try {
    const run = input.runCommand ?? runHostCommand;
    // The repository is resolved from the Project's checkout through the same runner; unresolved is a bounded failed attempt.
    const resolved = run({ command: "gh", args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], cwd: input.repoRoot, timeoutMs: 30_000 });
    const repo = resolved.status === 0 ? resolved.stdout.trim() : "";
    if (!repo) throw new Error(`no GitHub repository could be resolved from the Project's checkout: ${resolved.error ?? (resolved.stderr.trim() || "gh repo view returned nothing")}`);
    const marker = parkIssueMarker(actionKey, episode);
    let existing: string | null = null;
    if (row.issue_attempts >= 1) {
      const found = run({ command: "gh", args: ["issue", "list", "--repo", repo, "--state", "all", "--search", `"${marker}" in:body`, "--json", "number,url,body", "--limit", "5"], cwd: input.repoRoot, timeoutMs: 30_000 });
      if (found.status !== 0) throw new Error(`could not check for an existing Issue: ${found.error ?? (found.stderr.trim() || `gh issue list exit ${String(found.status)}`)}`);
      let listed: Array<{ url?: unknown; body?: unknown }>;
      try { listed = JSON.parse(found.stdout || "[]") as typeof listed; } catch { throw new Error("could not check for an existing Issue: unreadable gh issue list output"); }
      const match = Array.isArray(listed) ? listed.find((entry) => typeof entry?.url === "string" && typeof entry.body === "string" && entry.body.includes(`<!-- ${marker} -->`)) : undefined;
      existing = typeof match?.url === "string" ? match.url : null;
    }
    if (existing !== null) url = existing;
    else {
      const remedy = `arcadia production reset-repair-budget ${actionKey}`;
      const body = [
        `Arcadia parked \`${actionKey}\` on an Action-local \`repair_budget_exhausted\` hold (Decision 0223 A): its repair budget is spent, its candidate and counters are kept, and the run continues past it.`,
        "",
        `- **Action:** \`${actionKey}\``,
        `- **Failure:** ${oneLinePark(input.message)}`,
        `- **Park began:** ${episode}`,
        `- **Revival trigger:** repair the underlying problem, then run \`${remedy}\`; the Action is eligible again only after that reset.`,
        "",
        `<!-- ${marker} -->`
      ].join("\n");
      const result = run({ command: "gh", args: ["issue", "create", "--repo", repo, "--title", `Action parked on repair_budget_exhausted: ${actionKey}`, "--body", body], cwd: input.repoRoot, timeoutMs: 30_000 });
      if (result.status === 0) url = result.stdout.trim().split("\n").at(-1)?.trim() || "(filed; GitHub returned no URL)";
      else error = result.error ?? (result.stderr.trim() || `exit ${String(result.status)}`);
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  db.prepare("UPDATE production_repair_park_issues SET issue_url = ?, issue_error = ?, updated_at = ? WHERE action_key = ? AND episode = ?").run(url, error, at, actionKey, episode);
  if (error !== null) input.log?.(`Filing the Issue for the parked ${actionKey} failed (attempt ${row.issue_attempts + 1} of ${MAX_PARK_ISSUE_ATTEMPTS}); the park is unchanged: ${error}`);
  else input.log?.(`Filed ${url} for the parked ${actionKey}; revival trigger: arcadia production reset-repair-budget ${actionKey}.`);
}
