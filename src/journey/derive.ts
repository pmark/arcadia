import type Database from "better-sqlite3";
import { MAX_VERDICT_ATTEMPTS } from "../sessions/roleLineage.js";
import { MAX_REVIEW_REPAIR_ROUNDS } from "../sessions/reviewRepair.js";
import { classifyObstacle } from "./classify.js";
import {
  JOURNEY_SCHEMA,
  type Journey,
  type JourneyBranch,
  type JourneyBudget,
  type JourneyEvent,
  type JourneyRef
} from "./schema.js";

/**
 * Derive one Action's journey from the workspace database. Read-only, no
 * model call, no network: every event names the table it came from.
 *
 * The path is told in the records the worker already keeps: production
 * admissions (launch), candidate preservation receipts (each PR is a victory),
 * independent-verdict attempts (failed reviews are obstacles, cleared once a
 * repair round launches), review-repair rows, red alerts, launch refusals,
 * review-step errors, operator escalations and worker merges.
 */
/**
 * Where the reviewed head landed, when it is already part of the base branch:
 * the first base-branch commit that contains it. The command answers this
 * with read-only local Git; tests pass a stub.
 */
export type IntegrationLookup = (input: { repositoryPath: string; head: string; baseBranch: string }) => { commit: string; at: string } | null;

export function deriveJourney(db: Database.Database, actionKey: string, now: Date, deps: { integration?: IntegrationLookup } = {}): Journey {
  const [project, actionId] = splitActionKey(actionKey);
  const warnings: string[] = [];
  const events: JourneyEvent[] = [];
  const has = (table: string) => tableExists(db, table);

  const sessions = has("agent_sessions")
    ? (db.prepare(`SELECT id, plan_slug, work_item_id, repository_path, base_revision, status, branch, prepared_at, started_at, ended_at
        FROM agent_sessions WHERE project_slug = ? AND action_id = ? AND is_simulated = 0
        ORDER BY prepared_at, id`).all(project, actionId) as SessionRow[])
    : [];
  const latestSession = sessions.at(-1) ?? null;
  const plan = latestSession?.plan_slug ?? null;
  const title = latestSession && has("work_items")
    ? ((db.prepare("SELECT title FROM work_items WHERE id = ?").get(latestSession.work_item_id) as { title: string } | undefined)?.title ?? null)
    : null;
  if (sessions.length === 0) warnings.push(`No Session has run for ${actionKey} yet.`);

  // Pull requests, by branch and by head.
  const prByBranch = new Map<string, JourneyRef>();
  const prByHead = new Map<string, JourneyRef>();
  const preservations = sessions.length > 0 && has("candidate_preservation_receipts")
    ? (db.prepare(`SELECT branch, base_branch, commit_sha, pull_request_number, pull_request_url, created_at
        FROM candidate_preservation_receipts WHERE action_id = ? ORDER BY created_at`).all(actionId) as PreservationRow[])
        .filter((row) => sessions.some((session) => session.branch === row.branch))
    : [];
  for (const row of preservations) {
    const ref = prRef(row.pull_request_url, row.pull_request_number);
    if (ref) prByBranch.set(row.branch, ref);
  }
  const steps = has("production_review_steps")
    ? (db.prepare(`SELECT request_id, session_id, target_head, pull_request_url, failures, total_failures, failure_step,
        last_error, last_outcome_json, created_at, updated_at
        FROM production_review_steps WHERE action_key = ? ORDER BY created_at`).all(actionKey) as StepRow[])
    : [];
  for (const step of steps) {
    const ref = prRef(step.pull_request_url, null);
    if (ref) prByHead.set(step.target_head, ref);
  }
  const repairs = has("production_review_repairs")
    ? (db.prepare(`SELECT request_id, policy_epoch, round, failed_session_id, failed_head, pull_request_url, role, verdict,
        summary, repair_session_id, outcome, reason, created_at, updated_at, closed_at
        FROM production_review_repairs WHERE action_key = ? ORDER BY created_at`).all(actionKey) as RepairRow[])
    : [];
  for (const repair of repairs) {
    const ref = prRef(repair.pull_request_url, null);
    if (ref && !prByHead.has(repair.failed_head)) prByHead.set(repair.failed_head, ref);
  }
  const sessionPr = (sessionId: string | null) => {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    return session ? (prByBranch.get(session.branch) ?? null) : null;
  };

  // Launch.
  const admissions = has("production_admissions")
    ? (db.prepare(`SELECT committed_at FROM production_admissions
        WHERE action_key = ? AND committed_at IS NOT NULL ORDER BY committed_at`).all(actionKey) as Array<{ committed_at: string }>)
    : [];
  const firstSession = sessions[0];
  if (firstSession) {
    events.push({
      at: admissions[0]?.committed_at ?? firstSession.started_at ?? firstSession.prepared_at,
      kind: "launch",
      label: "launched",
      detail: `Launched Session ${firstSession.id} on ${firstSession.branch}.`,
      class: null,
      ref: { kind: "session", id: firstSession.id, url: null },
      source: admissions.length > 0 ? "production_admissions" : "agent_sessions"
    });
  }

  // Each preserved candidate PR is a victory; a later one supersedes the earlier.
  let previousPr: JourneyRef | null = null;
  for (const row of preservations) {
    const ref = prByBranch.get(row.branch) ?? null;
    if (!ref) continue;
    const session = sessions.find((candidate) => candidate.branch === row.branch);
    const repair = repairs.find((candidate) => candidate.repair_session_id === session?.id);
    const parts = [`Candidate preserved in PR #${ref.id} at ${short(row.commit_sha)}.`];
    if (repair) parts.push(`Repair round ${repair.round} of this production run launched unattended after a failed ${repair.role}.`);
    if (previousPr && previousPr.id !== ref.id) parts.push(`Supersedes #${previousPr.id}.`);
    events.push({ at: row.created_at, kind: "victory", label: `#${ref.id}`, detail: parts.join(" "), class: null, ref, source: "candidate_preservation_receipts" });
    previousPr = ref;
  }

  // Sessions that ended without an accepted completion are obstacles.
  const exits = sessions.length > 0 && has("session_exit_receipts")
    ? (db.prepare(`SELECT session_id, outcome, reason, created_at FROM session_exit_receipts
        WHERE session_id IN (${sessions.map(() => "?").join(", ")})`).all(...sessions.map((session) => session.id)) as ExitRow[])
    : [];
  for (const exit of exits) {
    if (exit.outcome === "accepted_completion" || exit.outcome === "successful_exit") continue;
    const later = sessions.some((session) => session.prepared_at > exit.created_at);
    events.push(obstacle(exit.created_at, later, `session ${exit.outcome.replaceAll("_", " ")}`, exit.reason,
      { kind: "session", id: exit.session_id, url: null }, "session_exit_receipts"));
  }

  // Independent verdicts.
  const attempts = plan && has("session_role_attempts")
    ? (db.prepare(`SELECT role, ordinal, status, input_revision, target_head, terminal_receipt_json, created_at, updated_at
        FROM session_role_attempts WHERE requirement_id = ? ORDER BY created_at, ordinal`).all(`${project}/${plan}/${actionId}`) as AttemptRow[])
    : [];
  const developments = attempts.filter((attempt) => attempt.role === "development");
  const verdicts = attempts.filter((attempt) => attempt.role === "code-review" || attempt.role === "qa");
  const latestHead = developments.at(-1)?.target_head ?? steps.at(-1)?.target_head ?? null;
  for (const verdict of verdicts) {
    const at = verdict.updated_at > verdict.created_at ? verdict.updated_at : verdict.created_at;
    const ref = verdict.target_head ? (prByHead.get(verdict.target_head) ?? null) : null;
    const word = verdict.role === "qa" ? "QA" : "review";
    if (verdict.status === "passed") {
      events.push({ at, kind: "victory", label: `${word} passed`, detail: `The independent ${verdict.role} passed on ${short(verdict.target_head)} (attempt ${verdict.ordinal}).`, class: null, ref, source: "session_role_attempts" });
      continue;
    }
    if (verdict.status !== "failed") continue;
    const receipt = parseJson(verdict.terminal_receipt_json);
    // A verdict recorded on a binding that changed while it ran is failed as stale, whatever it said.
    const outcome = receipt.stale === true ? "stale" : typeof receipt.verdict === "string" ? receipt.verdict : "fail";
    const repair = repairs.find((candidate) => candidate.failed_head === verdict.target_head && candidate.role === verdict.role);
    const detail = `Independent ${verdict.role} attempt ${verdict.ordinal} on ${short(verdict.target_head)}: ${outcome}.${repair ? ` ${repair.summary}` : ""}`;
    const cleared = developments.some((development) => development.created_at > at)
      || verdicts.some((later) => later.role === verdict.role && later.status === "passed" && later.created_at > at);
    events.push(obstacle(at, cleared, `${word} ${outcome}`, detail, ref, "session_role_attempts"));
  }

  // Repair rounds that stopped instead of launching.
  for (const repair of repairs) {
    if (repair.outcome !== "gated" && repair.outcome !== "escalated") continue;
    const cleared = repair.closed_at !== null || developments.some((development) => development.created_at > repair.updated_at);
    events.push(obstacle(repair.updated_at, cleared, `repair ${repair.outcome}`, repair.reason ?? repair.summary,
      prByHead.get(repair.failed_head) ?? null, "production_review_repairs"));
  }

  // Red alerts.
  if (has("production_red_alerts")) {
    const alerts = db.prepare(`SELECT id, trigger, detail, status, first_seen_at FROM production_red_alerts
      WHERE action_key = ? ORDER BY first_seen_at`).all(actionKey) as AlertRow[];
    for (const alert of alerts) {
      events.push(obstacle(alert.first_seen_at, alert.status === "cleared", alert.trigger.replaceAll("_", " "), alert.detail,
        { kind: "alert", id: alert.id, url: null }, "production_red_alerts"));
    }
  }

  // The latest launch refusal, cleared once an admission follows it.
  if (has("production_launch_refusal_log")) {
    const refusal = db.prepare("SELECT message, first_at, last_at FROM production_launch_refusal_log WHERE action_key = ?").get(actionKey) as
      { message: string; first_at: string; last_at: string } | undefined;
    if (refusal) {
      const cleared = admissions.some((admission) => admission.committed_at > refusal.last_at);
      events.push(obstacle(refusal.first_at, cleared, "launch refused", refusal.message, null, "production_launch_refusal_log"));
    }
  }

  // Review-step mechanics (push, ready, checks) that errored.
  steps.forEach((step, index) => {
    if (!step.last_error) return;
    const cleared = index < steps.length - 1 || step.failures === 0;
    events.push(obstacle(step.updated_at, cleared, `${step.failure_step ?? "review step"} error`, step.last_error,
      prByHead.get(step.target_head) ?? null, "production_review_steps"));
  });

  // Worker merges: merged reaches the destination, a refusal is an obstacle.
  let merged: { at: string; ref: JourneyRef | null } | null = null;
  if (has("production_worker_merges")) {
    const merges = db.prepare(`SELECT head, pull_request_url, outcome, code, reason, updated_at FROM production_worker_merges
      WHERE action_key = ? ORDER BY updated_at`).all(actionKey) as MergeRow[];
    merges.forEach((merge, index) => {
      const ref = prRef(merge.pull_request_url, null);
      if (merge.outcome === "merged") {
        merged = { at: merge.updated_at, ref };
        return;
      }
      events.push(obstacle(merge.updated_at, index < merges.length - 1, `merge ${merge.code ?? merge.outcome}`, merge.reason, ref, "production_worker_merges"));
    });
  }

  // A head merged any other way (the operator's merge, a fast-forward) is
  // already in the base branch: the destination is reached all the same.
  // A head equal to the Session's own base revision changed nothing and proves no arrival.
  if (merged === null && latestHead && latestSession && latestHead !== latestSession.base_revision && deps.integration) {
    const baseBranch = preservations.at(-1)?.base_branch ?? "main";
    try {
      const integrated = deps.integration({ repositoryPath: latestSession.repository_path, head: latestHead, baseBranch });
      if (integrated) merged = { at: integrated.at, ref: prByHead.get(latestHead) ?? sessionPr(latestSession.id) };
    } catch (error) {
      warnings.push(`Could not tell whether ${short(latestHead)} reached ${baseBranch}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Once there, every obstacle met on the way was got past.
  const arrival = merged;
  if (arrival) {
    for (const event of events) if (event.kind === "obstacle" && event.at <= arrival.at) event.kind = "cleared";
  }

  // Operator escalations that need a person are open obstacles; waiting ones only describe "now".
  const escalation = has("production_operator_escalations")
    ? (db.prepare("SELECT kind, message, first_detected_at, last_seen_at FROM production_operator_escalations WHERE action_key = ?").get(actionKey) as EscalationRow | undefined)
    : undefined;
  // A repair escalation is already told by its review-repair row above.
  const repairTold = REVIEW_REPAIR_ESCALATION_KINDS.has(escalation?.kind ?? "")
    && events.some((event) => event.kind === "obstacle" && event.source === "production_review_repairs");
  if (escalation && !WAITING_ESCALATIONS.has(escalation.kind) && !repairTold && merged === null) {
    events.push(obstacle(escalation.first_detected_at, false, escalation.kind.replaceAll("_", " "), escalation.message,
      latestHead ? (prByHead.get(latestHead) ?? null) : null, "production_operator_escalations"));
  }

  events.sort((left, right) => left.at.localeCompare(right.at) || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]);

  // Budgets.
  // Verdict attempts are budgeted per role per requirement input revision
  // (MAX_VERDICT_ATTEMPTS); the tightest role is the one that ends the loop.
  const inputRevision = developments.at(-1)?.input_revision ?? verdicts.at(-1)?.input_revision ?? null;
  const latestVerdictRole = (["code-review", "qa"] as const)
    .map((role) => verdicts.filter((attempt) => attempt.role === role && attempt.input_revision === inputRevision))
    .sort((left, right) => right.length - left.length)[0] ?? [];
  const reviewAttempts: JourneyBudget = {
    spent: latestVerdictRole.filter((attempt) => attempt.status === "passed" || attempt.status === "failed").length,
    inUse: latestVerdictRole.filter((attempt) => attempt.status === "pending" || attempt.status === "running").length,
    limit: MAX_VERDICT_ATTEMPTS
  };
  // Repair rounds are counted per production epoch (the run), as launchedRepairRounds does.
  const policy = has("production_policy") ? (db.prepare("SELECT epoch FROM production_policy WHERE id = 'workspace'").get() as { epoch: number } | undefined) : undefined;
  const epoch = policy?.epoch ?? repairs.reduce((max, repair) => Math.max(max, repair.policy_epoch), 0);
  const launchedRepairs = repairs.filter((repair) => repair.policy_epoch === epoch && repair.repair_session_id !== null);
  const repairRounds: JourneyBudget = {
    spent: launchedRepairs.length,
    inUse: launchedRepairs.filter((repair) => sessions.some((session) => session.id === repair.repair_session_id && isLive(session))).length,
    limit: MAX_REVIEW_REPAIR_ROUNDS
  };

  const latestPr = latestHead ? (prByHead.get(latestHead) ?? (latestSession ? sessionPr(latestSession.id) : null)) : (latestSession ? sessionPr(latestSession.id) : null);
  const reached = merged;
  const destination = {
    label: "PR merged",
    reached: reached !== null,
    at: reached?.at ?? null,
    ref: reached?.ref ?? latestPr
  };

  const nowEvent = reached ? null : currentPosition({ now, latestSession, steps, escalation, latestPr, events });
  const headVerdicts = verdicts.filter((attempt) => attempt.target_head === latestHead);
  const passedRoles = new Set(headVerdicts.filter((attempt) => attempt.status === "passed").map((attempt) => attempt.role));
  const gate: JourneyEvent | null = reached || !latestHead || (passedRoles.has("code-review") && passedRoles.has("qa"))
    ? null
    : {
        at: nowEvent?.at ?? now.toISOString(),
        kind: "gate",
        label: "independent review",
        detail: `Independent code review and QA of ${short(latestHead)}: ${reviewAttempts.spent} of ${reviewAttempts.limit} verdict attempts spent${reviewAttempts.inUse > 0 ? `, ${reviewAttempts.inUse} in progress` : ""}.`,
        class: null,
        ref: latestPr,
        source: "session_role_attempts"
      };

  const attemptsLeft = reviewAttempts.limit - reviewAttempts.spent - reviewAttempts.inUse;
  const roundsLeft = repairRounds.limit - repairRounds.spent;
  const lastVerdictFailed = headVerdicts.at(-1)?.status === "failed";
  const ahead: JourneyBranch[] = reached
    ? []
    : [
        attemptsLeft <= 0 && lastVerdictFailed
          ? { id: "pass", label: "No verdict attempt left: the operator reruns the review or merges by hand", available: true, likely: true }
          : { id: "pass", label: "Review passes: the worker merges", available: true, likely: true },
        {
          id: "repair",
          label: roundsLeft > 0 && attemptsLeft > 1
            ? `Repairable fail: repair round ${repairRounds.spent + 1} of ${repairRounds.limit}, then review again`
            : "Repairable fail: no repair budget left, the operator decides",
          available: roundsLeft > 0 && attemptsLeft > 1,
          likely: false
        }
      ];

  return {
    schema: JOURNEY_SCHEMA,
    generatedAt: now.toISOString(),
    action: { key: actionKey, project, plan, id: actionId, title },
    destination,
    events,
    now: nowEvent,
    gate,
    budget: { reviewAttempts, repairRounds },
    ahead,
    warnings
  };
}

export function splitActionKey(actionKey: string): [string, string] {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(actionKey);
  if (!match) throw new Error(`Expected <project>/<action>, got "${actionKey}".`);
  return [match[1], match[2]];
}

/** Escalation kinds that describe an ordinary wait the worker resolves itself. */
const WAITING_ESCALATIONS: ReadonlySet<string> = new Set(["awaiting_independent_verdicts"]);
const REVIEW_REPAIR_ESCALATION_KINDS: ReadonlySet<string> = new Set(["review_repair_gated", "review_repair_rounds_exhausted"]);

const KIND_ORDER: Record<JourneyEvent["kind"], number> = { launch: 0, obstacle: 1, cleared: 1, victory: 2, gate: 3, now: 4 };

function currentPosition(input: {
  now: Date;
  latestSession: SessionRow | null;
  steps: StepRow[];
  escalation: EscalationRow | undefined;
  latestPr: JourneyRef | null;
  events: JourneyEvent[];
}): JourneyEvent {
  const { latestSession, latestPr } = input;
  const at = (fallback: string) => {
    const lastEvent = input.events.at(-1)?.at ?? fallback;
    return fallback > lastEvent ? fallback : lastEvent;
  };
  const pr = latestPr ? `#${latestPr.id} ` : "";
  if (!latestSession) {
    return { at: input.now.toISOString(), kind: "now", label: "not launched", detail: "No Session has run for this Action yet.", class: null, ref: null, source: "agent_sessions" };
  }
  if (isLive(latestSession)) {
    return {
      at: at(latestSession.started_at ?? latestSession.prepared_at),
      kind: "now",
      label: `${pr}session running`.trim(),
      detail: `Session ${latestSession.id} is ${latestSession.status} on ${latestSession.branch}.`,
      class: null,
      ref: { kind: "session", id: latestSession.id, url: null },
      source: "agent_sessions"
    };
  }
  const step = input.steps.filter((candidate) => candidate.session_id === latestSession.id).at(-1);
  if (step) {
    const outcome = parseJson(step.last_outcome_json);
    const reason = typeof outcome.reason === "string" ? outcome.reason : "Waiting for the next pull-request poll.";
    return {
      at: at(step.updated_at),
      kind: "now",
      label: `${pr}${stepPhase(outcome)}`,
      detail: firstLine(input.escalation?.message ?? reason),
      class: null,
      ref: latestPr,
      source: "production_review_steps"
    };
  }
  return {
    at: at(latestSession.ended_at ?? latestSession.prepared_at),
    kind: "now",
    label: `${pr}settled`.trim(),
    detail: firstLine(input.escalation?.message ?? `Session ${latestSession.id} ended ${latestSession.status}.`),
    class: null,
    ref: latestPr ?? { kind: "session", id: latestSession.id, url: null },
    source: "agent_sessions"
  };
}

function stepPhase(outcome: Record<string, unknown>): string {
  const reason = typeof outcome.reason === "string" ? outcome.reason : "";
  if (outcome.kind === "blocked") return "blocked";
  if (outcome.kind === "waiting") return /required checks/i.test(reason) ? "awaiting checks" : "waiting";
  if (outcome.kind === "advanced") {
    if (outcome.step === "pushed") return "pushed";
    if (outcome.step === "ready") return "in review";
    return `${String(outcome.step)} passed`;
  }
  return "in review";
}

function obstacle(at: string, cleared: boolean, label: string, detail: string, ref: JourneyRef | null, source: string): JourneyEvent {
  const summary = firstLine(detail);
  return { at, kind: cleared ? "cleared" : "obstacle", label, detail: summary, class: classifyObstacle(`${label} ${summary}`), ref, source };
}

/**
 * The headline of a record's message. Escalations and verdicts append whole
 * review reports; the journey keeps the first line (bounded) and the report
 * stays one ref away, so classification never reads a reviewer's quotation.
 */
export function firstLine(text: string, limit = 400): string {
  const line = text.split("\n", 1)[0].trim();
  const sentenceEnd = line.indexOf(" Findings (");
  const head = sentenceEnd > 0 ? line.slice(0, sentenceEnd) : line;
  return head.length > limit ? `${head.slice(0, limit - 1)}…` : head;
}

function prRef(url: string | null, number: number | null): JourneyRef | null {
  const id = number !== null ? String(number) : (url ? /\/pull\/(\d+)/.exec(url)?.[1] ?? null : null);
  return id ? { kind: "pr", id, url } : null;
}

function isLive(session: SessionRow): boolean {
  return session.status === "prepared" || session.status === "running" || session.status === "needs_input";
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "an unknown head";
}

function parseJson(raw: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

interface SessionRow { id: string; plan_slug: string; work_item_id: string; repository_path: string; base_revision: string; status: string; branch: string; prepared_at: string; started_at: string | null; ended_at: string | null }
interface PreservationRow { branch: string; base_branch: string; commit_sha: string; pull_request_number: number | null; pull_request_url: string | null; created_at: string }
interface StepRow { request_id: string; session_id: string; target_head: string; pull_request_url: string; failures: number; total_failures: number; failure_step: string | null; last_error: string | null; last_outcome_json: string | null; created_at: string; updated_at: string }
interface RepairRow { request_id: string; policy_epoch: number; round: number; failed_session_id: string; failed_head: string; pull_request_url: string | null; role: string; verdict: string; summary: string; repair_session_id: string | null; outcome: string; reason: string | null; created_at: string; updated_at: string; closed_at: string | null }
interface ExitRow { session_id: string; outcome: string; reason: string; created_at: string }
interface AttemptRow { role: string; ordinal: number; status: string; input_revision: string; target_head: string | null; terminal_receipt_json: string | null; created_at: string; updated_at: string }
interface AlertRow { id: string; trigger: string; detail: string; status: string; first_seen_at: string }
interface MergeRow { head: string; pull_request_url: string | null; outcome: string; code: string | null; reason: string; updated_at: string }
interface EscalationRow { kind: string; message: string; first_detected_at: string; last_seen_at: string }
