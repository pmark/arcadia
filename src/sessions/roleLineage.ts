import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanActionDoc } from "../docs/types.js";
import { isAncestor, tryGit } from "../git/worktrees.js";
import type { CandidatePreservationReceipt } from "./candidatePreservation.js";
import {
  actedAsDeveloper,
  allocateSessionRoleAttempt,
  attemptVerdictIsCurrent,
  getSessionRoleAttempt,
  INDEPENDENT_VERDICT_ROLES,
  latestRoleAttempt,
  liveMutationOwner,
  markSessionRoleAttemptRunning,
  recordSessionRoleAttemptTerminal,
  type IndependentVerdictRole,
  type SessionRoleAttempt,
  type VerdictBinding
} from "./enrollment.js";
import type { AgentSession } from "./index.js";
import type { SessionExitOutcome } from "./reconciliation.js";

/**
 * Wiring of the fixed five-role attempt store (`session_role_attempts`) into
 * the executors that already exist. Nothing here schedules work or invents a
 * role framework: the guarded launcher owns the development attempt, Session
 * exit reconciliation finishes it, the production tick's planning resolution
 * records the planner and the packet's deterministic critique, independent
 * reviewers record exact-head code review and QA through
 * {@link beginIndependentVerdict}/{@link finishIndependentVerdict}, and the
 * tick integrates a candidate only through {@link independentVerdictGate}.
 *
 * Only `development` owns mutations. Every other role is a separately
 * identified, read-only helper with respect to the candidate.
 */

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface RequirementIdentity {
  projectSlug: string;
  planSlug: string;
  actionId: string;
  /** `project/plan/action`: stable across criteria revisions. */
  requirementId: string;
  /** Everything about the governed Action that may change what the work must do. */
  inputRevision: string;
  /** The governed acceptance criteria alone, which every verdict binds. */
  criteriaFingerprint: string;
}

export function requirementIdFor(projectSlug: string, planSlug: string, actionId: string): string {
  return `${projectSlug}/${planSlug}/${actionId}`;
}

export function requirementIdentity(input: { projectSlug: string; planSlug: string; action: PlanActionDoc }): RequirementIdentity {
  const { action } = input;
  return {
    projectSlug: input.projectSlug,
    planSlug: input.planSlug,
    actionId: action.id,
    requirementId: requirementIdFor(input.projectSlug, input.planSlug, action.id),
    inputRevision: sha256({
      nextAction: action.nextAction,
      acceptanceCriteria: action.acceptanceCriteria,
      responsibility: action.responsibility,
      execution: action.resolvedExecution ?? action.execution ?? null
    }),
    criteriaFingerprint: sha256(action.acceptanceCriteria ?? [])
  };
}

// ---------------------------------------------------------------- development

function liveSessionFor(db: Database.Database, requirement: RequirementIdentity, exceptSessionId: string | null): string | null {
  const row = db.prepare(`SELECT id FROM agent_sessions WHERE project_slug = ? AND plan_slug = ? AND action_id = ?
    AND status IN ('prepared', 'running') AND id != ? LIMIT 1`)
    .get(requirement.projectSlug, requirement.planSlug, requirement.actionId, exceptSessionId ?? "") as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Read-only: what {@link beginDevelopmentAttempt} would do, refusing exactly
 * as it would. The guarded launcher calls it before any admission so a
 * lineage refusal reserves nothing, and allocates only after the admission's
 * Off/epoch cutoff committed, so an Off or stale-epoch refusal never leaves a
 * pending attempt behind.
 */
export function planDevelopmentAttempt(db: Database.Database, input: {
  requirement: RequirementIdentity;
  retryAuthorized: boolean;
  /** The launch's own prepared Session, which never counts as another live holder. */
  exceptSessionId?: string | null;
  maxOrdinal?: number;
}): { kind: "resume"; attempt: SessionRoleAttempt } | { kind: "allocate"; supersedes: SessionRoleAttempt | null } {
  const live = liveMutationOwner(db, input.requirement.requirementId);
  if (live && live.input_revision === input.requirement.inputRevision) return { kind: "resume", attempt: live };
  if (live) {
    // A revised input supersedes the live owner only when no Session is still
    // working under it: a live developer is never displaced mid-flight.
    const holder = liveSessionFor(db, input.requirement, input.exceptSessionId ?? null);
    if (holder) {
      throw validationError("Another development attempt already owns this requirement's mutations; its Session is still live.", {
        code: "mutation_owner_active", requestId: live.request_id, sessionId: holder
      });
    }
  }
  const previous = latestRoleAttempt(db, input.requirement.requirementId, input.requirement.inputRevision, "development");
  if (previous && (previous.status !== "failed" || !input.retryAuthorized)) {
    throw validationError("A next attempt requires an explicitly authorized retry after terminal failure.", {
      code: previous.status === "pending" || previous.status === "running" ? "attempt_in_progress" : "attempt_retry_not_authorized",
      requestId: previous.request_id, status: previous.status
    });
  }
  const limit = input.maxOrdinal ?? 3;
  if ((previous?.ordinal ?? 0) + 1 > limit) {
    throw validationError("The bounded attempt limit is exhausted.", {
      code: "attempt_limit_exhausted", requirementId: input.requirement.requirementId, role: "development", limit
    });
  }
  return { kind: "allocate", supersedes: live };
}

/**
 * The one mutation-owning attempt a launch runs under. A live attempt for the
 * same requirement input is resumed (a crash before, or a resumable exit
 * after, a Session start never allocates a second owner); a live attempt for
 * an older input revision is superseded and failed first, but only when no
 * other Session still runs under it. Otherwise a new attempt is allocated;
 * after a terminal failure that is the next bounded ordinal, authorized by
 * the launch grant the caller holds.
 */
export function beginDevelopmentAttempt(db: Database.Database, input: {
  requirement: RequirementIdentity;
  requestId: string;
  retryAuthorized: boolean;
  exceptSessionId?: string | null;
  now: Date;
}): { attempt: SessionRoleAttempt; resumed: boolean } {
  return writeTransaction(db, () => {
    const plan = planDevelopmentAttempt(db, input);
    if (plan.kind === "resume") return { attempt: plan.attempt, resumed: true };
    if (plan.supersedes) {
      recordSessionRoleAttemptTerminal(db, {
        requestId: plan.supersedes.request_id, actorId: plan.supersedes.actor_id, status: "failed", now: input.now,
        receipt: { reason: "superseded: the governed Action input changed before this attempt finished", supersededBy: input.requestId }
      });
    }
    // Bounded transport identity derived from the launch request, so a replay
    // of the same launch maps onto the same attempt whatever its id's shape.
    const requestId = `development-${sha256([input.requirement.requirementId, input.requestId]).slice(0, 32)}`;
    const attempt = allocateSessionRoleAttempt(db, {
      requirementId: input.requirement.requirementId,
      inputRevision: input.requirement.inputRevision,
      role: "development",
      requestId,
      // The developer principal is the launch request that first allocated the
      // attempt; every Session that later resumes it acts under that identity.
      actorId: requestId,
      mutationOwner: true,
      retryAuthorized: input.retryAuthorized,
      authorityCurrent: true,
      now: input.now
    });
    return { attempt, resumed: false };
  });
}

export function markDevelopmentAttemptRunning(db: Database.Database, attempt: SessionRoleAttempt, now: Date): SessionRoleAttempt {
  return markSessionRoleAttemptRunning(db, { requestId: attempt.request_id, actorId: attempt.actor_id, now });
}

/**
 * Called inside the Session exit receipt's own transaction, so the attempt's
 * terminal state commits with the receipt or not at all (a replayed
 * reconciliation finds the receipt and never re-settles). Resumable exits keep
 * the attempt live for the next launch to resume.
 */
export function settleDevelopmentAttemptForExit(db: Database.Database, input: {
  session: AgentSession;
  outcome: SessionExitOutcome;
  exitReceiptId: string;
  now: Date;
}): SessionRoleAttempt | null {
  const { session } = input;
  const live = liveMutationOwner(db, requirementIdFor(session.project_slug, session.plan_slug, session.action_id));
  if (!live) return null;
  const receipt = { sessionId: session.id, outcome: input.outcome, exitReceiptId: input.exitReceiptId };
  if (input.outcome === "accepted_completion") {
    // Accepted work passed even when its worktree is already gone; without a
    // readable head no verdict can bind it, so it can never be integrated by
    // the tick on that attempt alone.
    const head = tryGit(session.worktree_path, ["rev-parse", "HEAD"])?.trim() || undefined;
    return recordSessionRoleAttemptTerminal(db, { requestId: live.request_id, actorId: live.actor_id, status: "passed", now: input.now,
      ...(head ? { targetHead: head } : {}), receipt: head ? receipt : { ...receipt, headUnreadable: true } });
  }
  if (input.outcome === "failed_execution" || input.outcome === "missing_evidence") {
    return recordSessionRoleAttemptTerminal(db, { requestId: live.request_id, actorId: live.actor_id, status: "failed", now: input.now, receipt });
  }
  return live;
}

// ----------------------------------------------------- planner and critique

/**
 * A read-only host helper attempt (planner, critique). The transport identity
 * is derived from the requirement input and the bounded ordinal, so a crashed
 * or interrupted attempt is resumed under the same identity.
 *
 * Only a real result is terminal. `run` returning `inconclusive` (nothing was
 * prepared) or throwing (a busy database, a Git or I/O failure) leaves the
 * attempt live, so transient infrastructure failures never consume an
 * ordinal; the next call resumes the same one. A failed result is retried as
 * the next ordinal only when `retryAuthorized`. A passed result is replayed
 * unless `rerunPassed` says the caller has deterministically observed that
 * it no longer stands (planning is required again under the same input).
 *
 * Callers are serialized per workspace (the single worker tick). If another
 * writer nonetheless finishes the same attempt first, its identical-outcome
 * terminal write is accepted as already done rather than failing the caller.
 */
export function runHelperAttempt<T>(db: Database.Database, input: {
  role: "planner" | "critique";
  requirement: RequirementIdentity;
  actorId: string;
  retryAuthorized: boolean;
  rerunPassed?: boolean;
  maxOrdinal?: number;
  now: Date;
}, run: () => { outcome: "passed" | "failed" | "inconclusive"; receipt: T }): { attempt: SessionRoleAttempt; receipt: T; replayed: boolean; finished: boolean } {
  const latest = latestRoleAttempt(db, input.requirement.requirementId, input.requirement.inputRevision, input.role);
  if ((latest?.status === "passed" && !input.rerunPassed) || (latest?.status === "failed" && !input.retryAuthorized)) {
    return { attempt: latest, receipt: JSON.parse(latest.terminal_receipt_json ?? "null") as T, replayed: true, finished: true };
  }
  const ordinal = latest === null ? 1 : latest.status === "failed" || latest.status === "passed" ? latest.ordinal + 1 : latest.ordinal;
  const requestId = `${input.role}-${sha256([input.requirement.requirementId, input.requirement.inputRevision]).slice(0, 24)}-${ordinal}`;
  const attempt = allocateSessionRoleAttempt(db, {
    requirementId: input.requirement.requirementId,
    inputRevision: input.requirement.inputRevision,
    role: input.role,
    requestId,
    actorId: input.actorId,
    mutationOwner: false,
    retryAuthorized: input.retryAuthorized,
    authorityCurrent: true,
    ...(latest?.status === "passed" ? { supersedesPassed: latest.request_id } : {}),
    ...(input.maxOrdinal !== undefined ? { maxOrdinal: input.maxOrdinal } : {}),
    now: input.now
  });
  if (attempt.status === "passed" || attempt.status === "failed") {
    return { attempt, receipt: JSON.parse(attempt.terminal_receipt_json ?? "null") as T, replayed: true, finished: true };
  }
  markSessionRoleAttemptRunning(db, { requestId, actorId: input.actorId, now: input.now });
  // A throw propagates with the attempt still live: resumable, never terminal.
  const result = run();
  if (result.outcome === "inconclusive") {
    return { attempt: getSessionRoleAttempt(db, requestId) ?? attempt, receipt: result.receipt, replayed: false, finished: false };
  }
  let finished: SessionRoleAttempt;
  try {
    finished = recordSessionRoleAttemptTerminal(db, { requestId, actorId: input.actorId, status: result.outcome, now: input.now, receipt: result.receipt });
  } catch (error) {
    const raced = getSessionRoleAttempt(db, requestId);
    if ((error as { details?: { code?: string } }).details?.code === "attempt_terminal_changed" && raced?.status === result.outcome) {
      finished = raced;
    } else {
      throw error;
    }
  }
  return { attempt: finished, receipt: result.receipt, replayed: false, finished: true };
}

// ------------------------------------------------- independent verdicts

export type VerdictReadiness =
  | { ready: true; requirement: RequirementIdentity; binding: VerdictBinding; developer: SessionRoleAttempt }
  | { ready: false; requirement: RequirementIdentity | null; reasons: string[] };

function workerPreservation(db: Database.Database, session: AgentSession): CandidatePreservationReceipt | null {
  const row = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?")
    .get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.receipt_json) as CandidatePreservationReceipt; } catch { return null; }
}

/**
 * Deterministic readiness for an independent verdict. It reads only checked-in
 * documents, Git and receipts -- never a model -- and must hold before any
 * reviewer attempt is allocated or any reviewer inference starts. The binding
 * it returns changes whenever the candidate head moves (a push or commit), the
 * governed criteria change, or the preserved validation evidence changes, and
 * every verdict bound to the old binding is then no longer current.
 */
export function independentVerdictReadiness(db: Database.Database, input: { session: AgentSession; repoRoot: string }): VerdictReadiness {
  const { session } = input;
  const plan = discoverDocs(input.repoRoot).docs.find((doc) => doc.type === "plan" && doc.project === session.project_slug && doc.slug === session.plan_slug);
  const action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === session.action_id) : undefined;
  if (!action) return { ready: false, requirement: null, reasons: ["The governed Action is not in the checked-in Plan."] };
  const requirement = requirementIdentity({ projectSlug: session.project_slug, planSlug: session.plan_slug, action });
  const reasons: string[] = [];
  const developer = latestRoleAttempt(db, requirement.requirementId, requirement.inputRevision, "development");
  if (developer?.status !== "passed" || !developer.target_head) {
    reasons.push("No passed development attempt exists for the current governed Action input.");
  }
  const preserved = workerPreservation(db, session);
  if (!preserved?.validationEvidenceRef || !preserved.candidateFingerprint || preserved.actionId !== session.action_id) {
    reasons.push("The candidate has no canonical worker preservation receipt with passing validation evidence.");
  }
  const head = tryGit(session.worktree_path, ["rev-parse", "HEAD"])?.trim() ?? null;
  const status = tryGit(session.worktree_path, ["status", "--porcelain", "--untracked-files=all"]);
  const branchHead = tryGit(input.repoRoot, ["rev-parse", `refs/heads/${session.branch}`])?.trim() ?? null;
  if (!head || status === null || status.trim() || branchHead !== head) {
    reasons.push("The candidate worktree is missing, dirty, or differs from its branch.");
  } else {
    if (developer?.target_head && developer.target_head !== head) reasons.push("The candidate head changed after its development attempt finished.");
    if (preserved?.commitSha && !isAncestor(session.worktree_path, preserved.commitSha, head)) reasons.push("The candidate head does not descend from its preserved commit.");
  }
  if (reasons.length > 0 || !developer || !preserved || !head) return { ready: false, requirement, reasons };
  return {
    ready: true,
    requirement,
    developer,
    binding: {
      targetHead: head,
      criteriaFingerprint: requirement.criteriaFingerprint,
      evidenceFingerprint: sha256([preserved.id, preserved.commitSha, preserved.validationEvidenceRef, preserved.candidateFingerprint, preserved.packetSha256])
    }
  };
}

/** Resolves symlinks (macOS `/var` -> `/private/var`) on whichever prefix exists, so both sides compare canonically. */
function realPath(value: string): string {
  const resolved = path.resolve(value);
  const suffix: string[] = [];
  let existing = resolved;
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...suffix);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return resolved;
      suffix.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/** Every identity the developer acted under for this requirement: its attempt actors, Sessions, admissions and agent bindings. */
function developerPrincipals(db: Database.Database, session: AgentSession): { ids: Set<string>; worktrees: string[]; bindings: Set<string> } {
  const requirementId = requirementIdFor(session.project_slug, session.plan_slug, session.action_id);
  const ids = new Set<string>();
  for (const row of db.prepare("SELECT actor_id, request_id FROM session_role_attempts WHERE requirement_id = ? AND role = 'development'")
    .all(requirementId) as Array<{ actor_id: string; request_id: string }>) {
    ids.add(row.actor_id); ids.add(row.request_id);
  }
  const sessions = db.prepare(`SELECT id, admission_request_id, worktree_path, provider_binding_id FROM agent_sessions
    WHERE project_slug = ? AND plan_slug = ? AND action_id = ?`)
    .all(session.project_slug, session.plan_slug, session.action_id) as Array<{ id: string; admission_request_id: string | null; worktree_path: string; provider_binding_id: string | null }>;
  const bindings = new Set<string>();
  for (const row of sessions) {
    ids.add(row.id);
    if (row.admission_request_id) ids.add(row.admission_request_id);
    if (row.provider_binding_id) bindings.add(row.provider_binding_id);
  }
  return { ids, worktrees: sessions.map((row) => realPath(row.worktree_path)), bindings };
}

function within(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * What the host can observe about the reviewer, compared with every developer
 * identity for the requirement. The host cannot observe process ancestry
 * portably, so a reviewer process that shares no identity, working directory
 * or agent binding with the developer is accepted; the same provider family
 * or model under a different binding is permitted.
 */
function assertIndependentOf(db: Database.Database, session: AgentSession, input: { actorId: string; executionCwd: string; reviewerBindingId?: string | null }): void {
  const developer = developerPrincipals(db, session);
  const cwd = realPath(input.executionCwd);
  if (developer.ids.has(input.actorId) || developer.worktrees.some((worktree) => within(cwd, worktree)) ||
    (input.reviewerBindingId != null && developer.bindings.has(input.reviewerBindingId))) {
    throw validationError("Independent review and QA cannot be supplied by the developer.", {
      code: "independent_actor_required", actorId: input.actorId, executionCwd: cwd, reviewerBindingId: input.reviewerBindingId ?? null
    });
  }
}

/**
 * Start one exact-head code review or QA attempt. Deterministic readiness is
 * checked first and refuses before anything is allocated, so no reviewer
 * inference can run against an unready or unbound candidate. `actorId` and
 * `executionCwd` are the host-observed identity and working directory of the
 * reviewer process; neither may be the developer's.
 */
export function beginIndependentVerdict(db: Database.Database, input: {
  role: IndependentVerdictRole;
  session: AgentSession;
  repoRoot: string;
  requestId: string;
  actorId: string;
  executionCwd: string;
  /** The reviewer's host-selected agent binding, when the executor has one (QA does). */
  reviewerBindingId?: string | null;
  retryAuthorized?: boolean;
  maxOrdinal?: number;
  now: Date;
}): { attempt: SessionRoleAttempt; binding: VerdictBinding } {
  if (!(INDEPENDENT_VERDICT_ROLES as readonly string[]).includes(input.role)) {
    throw validationError("Only code review and QA record independent verdicts.", { code: "unknown_attempt_role" });
  }
  const replay = getSessionRoleAttempt(db, input.requestId);
  if (replay && replay.target_head && replay.criteria_fingerprint && replay.evidence_fingerprint) {
    // Transport replay: the same receipt, never a new attempt or a rebinding.
    if (replay.role !== input.role || replay.actor_id !== input.actorId) {
      throw validationError("Attempt request replay changed identity or input.", { code: "attempt_request_changed" });
    }
    return { attempt: replay, binding: { targetHead: replay.target_head, criteriaFingerprint: replay.criteria_fingerprint, evidenceFingerprint: replay.evidence_fingerprint } };
  }
  const readiness = independentVerdictReadiness(db, input);
  if (!readiness.ready) {
    throw validationError("The candidate is not deterministically ready for an independent verdict; no reviewer may run yet.", {
      code: "verdict_not_ready", reasons: readiness.reasons
    });
  }
  assertIndependentOf(db, input.session, input);
  // Restart: the same reviewer resumes its own unfinished attempt on the same
  // binding instead of allocating a duplicate under a fresh transport id.
  const unfinished = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, input.role);
  if (unfinished && (unfinished.status === "pending" || unfinished.status === "running") && unfinished.actor_id === input.actorId &&
    unfinished.target_head === readiness.binding.targetHead && unfinished.criteria_fingerprint === readiness.binding.criteriaFingerprint &&
    unfinished.evidence_fingerprint === readiness.binding.evidenceFingerprint) {
    return { attempt: markSessionRoleAttemptRunning(db, { requestId: unfinished.request_id, actorId: unfinished.actor_id, now: input.now }), binding: readiness.binding };
  }
  if (unfinished && (unfinished.status === "pending" || unfinished.status === "running") &&
    (unfinished.target_head !== readiness.binding.targetHead || unfinished.criteria_fingerprint !== readiness.binding.criteriaFingerprint ||
      unfinished.evidence_fingerprint !== readiness.binding.evidenceFingerprint)) {
    // Host reconciliation of an abandoned attempt whose binding is already
    // gone: it could only ever finish stale, so it is recorded so now.
    recordSessionRoleAttemptTerminal(db, { requestId: unfinished.request_id, actorId: unfinished.actor_id, status: "failed", now: input.now,
      receipt: { stale: true, reasons: ["Abandoned before finishing; the candidate binding has since changed."], reconciledBy: input.requestId } });
  }
  const attempt = allocateSessionRoleAttempt(db, {
    requirementId: readiness.requirement.requirementId,
    inputRevision: readiness.requirement.inputRevision,
    role: input.role,
    requestId: input.requestId,
    actorId: input.actorId,
    mutationOwner: false,
    retryAuthorized: input.retryAuthorized ?? false,
    authorityCurrent: true,
    maxOrdinal: input.maxOrdinal ?? 5,
    binding: readiness.binding,
    now: input.now
  });
  if (attempt.status === "pending") markSessionRoleAttemptRunning(db, { requestId: attempt.request_id, actorId: attempt.actor_id, now: input.now });
  return { attempt: getSessionRoleAttempt(db, attempt.request_id)!, binding: readiness.binding };
}

/**
 * Finish an independent verdict. If the candidate's binding moved while the
 * reviewer ran (a push, a criteria amendment, new evidence), the attempt is
 * recorded failed as stale instead of passing: a verdict on the old binding is
 * never current.
 */
export function finishIndependentVerdict(db: Database.Database, input: {
  requestId: string;
  actorId: string;
  session: AgentSession;
  repoRoot: string;
  verdict: "passed" | "failed";
  receipt: unknown;
  now: Date;
}): { attempt: SessionRoleAttempt; stale: boolean } {
  const attempt = getSessionRoleAttempt(db, input.requestId);
  if (!attempt) throw validationError("Attempt does not exist.", { code: "attempt_missing", requestId: input.requestId });
  if (attempt.actor_id !== input.actorId) throw validationError("Only the allocated actor may finish this attempt.", { code: "attempt_actor_changed" });
  if (attempt.status === "passed" || attempt.status === "failed") {
    // Transport replay of a finished verdict returns its immutable receipt.
    const stale = (JSON.parse(attempt.terminal_receipt_json ?? "{}") as { stale?: boolean } | null)?.stale === true;
    if (!stale && attempt.status !== input.verdict) throw validationError("A terminal attempt receipt is immutable.", { code: "attempt_terminal_changed" });
    return { attempt, stale };
  }
  const readiness = independentVerdictReadiness(db, input);
  const current = readiness.ready && attemptVerdictIsCurrent({ ...attempt, status: "passed" }, {
    head: readiness.binding.targetHead, criteriaFingerprint: readiness.binding.criteriaFingerprint, evidenceFingerprint: readiness.binding.evidenceFingerprint
  });
  if (!current) {
    return {
      attempt: recordSessionRoleAttemptTerminal(db, { requestId: input.requestId, actorId: input.actorId, status: "failed", now: input.now,
        receipt: { stale: true, verdict: input.verdict, reasons: readiness.ready ? ["The candidate binding changed while the reviewer ran."] : readiness.reasons, detail: input.receipt } }),
      stale: true
    };
  }
  return {
    attempt: recordSessionRoleAttemptTerminal(db, { requestId: input.requestId, actorId: input.actorId, status: input.verdict, now: input.now, receipt: input.receipt }),
    stale: false
  };
}

export type VerdictGate =
  | { satisfied: true; binding: VerdictBinding; verdicts: Record<IndependentVerdictRole, SessionRoleAttempt> }
  | { satisfied: false; code: "verdict_readiness_failed" | "awaiting_independent_verdicts"; reason: string; head: string | null; missing: string[] };

/**
 * What the tick consumes before integrating: a current, passing, independent
 * code review and QA for exactly this candidate binding. A verdict the
 * developer supplied, a failed or in-flight latest attempt, or one bound to an
 * earlier head, criteria or evidence does not satisfy it.
 */
export function independentVerdictGate(db: Database.Database, input: { session: AgentSession; repoRoot: string }): VerdictGate {
  const readiness = independentVerdictReadiness(db, input);
  if (!readiness.ready) {
    return { satisfied: false, code: "verdict_readiness_failed", head: null, missing: [],
      reason: `Integration waits on deterministic verdict readiness: ${readiness.reasons.join(" ")}` };
  }
  const developer = developerPrincipals(db, input.session);
  const verdicts: Partial<Record<IndependentVerdictRole, SessionRoleAttempt>> = {};
  const missing: string[] = [];
  for (const role of INDEPENDENT_VERDICT_ROLES) {
    const latest = latestRoleAttempt(db, readiness.requirement.requirementId, readiness.requirement.inputRevision, role);
    const independent = latest !== null && !developer.ids.has(latest.actor_id) && !actedAsDeveloper(db, readiness.requirement.requirementId, latest.actor_id);
    if (latest && independent && attemptVerdictIsCurrent(latest, {
      head: readiness.binding.targetHead, criteriaFingerprint: readiness.binding.criteriaFingerprint, evidenceFingerprint: readiness.binding.evidenceFingerprint
    })) {
      verdicts[role] = latest;
    } else {
      missing.push(latest === null ? `${role}: none` : !independent ? `${role}: not independent` : `${role}: ${latest.status === "passed" ? "stale" : latest.status}`);
    }
  }
  if (missing.length > 0) {
    return { satisfied: false, code: "awaiting_independent_verdicts", head: readiness.binding.targetHead, missing,
      reason: `Integration waits on current independent verdicts for head ${readiness.binding.targetHead.slice(0, 12)} (${missing.join("; ")}).` };
  }
  return { satisfied: true, binding: readiness.binding, verdicts: verdicts as Record<IndependentVerdictRole, SessionRoleAttempt> };
}

/**
 * The managed Session a pull-request head branch belongs to, but only when its
 * requirement carries development attempt lineage: a PR from anything else (a
 * human, an interactive `go` candidate, a pre-lineage Session) is not a
 * lineage-bound candidate and its QA is recorded exactly as before.
 */
export function lineageBoundSessionForBranch(db: Database.Database, input: { repositoryPath: string; branch: string }): AgentSession | null {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('agent_sessions', 'session_role_attempts')").all() as Array<{ name: string }>;
  if (tables.length !== 2) return null;
  let repositoryPath = path.resolve(input.repositoryPath);
  try { repositoryPath = realpathSync(repositoryPath); } catch { /* compared as given */ }
  const session = db.prepare(`SELECT * FROM agent_sessions WHERE branch = ? AND repository_path = ?
    ORDER BY prepared_at DESC, rowid DESC LIMIT 1`).get(input.branch, repositoryPath) as AgentSession | undefined;
  if (!session) return null;
  const lineage = db.prepare("SELECT 1 FROM session_role_attempts WHERE requirement_id = ? AND role = 'development' LIMIT 1")
    .get(requirementIdFor(session.project_slug, session.plan_slug, session.action_id));
  return lineage ? session : null;
}

/** Refuses unless the deterministic binding names exactly the head the reviewer is about to judge. */
export function assertVerdictHead(binding: VerdictBinding, reviewedHead: string): void {
  if (binding.targetHead !== reviewedHead) {
    throw validationError("The reviewed head is not the candidate's deterministically ready head; no reviewer may judge it.", {
      code: "verdict_not_ready", reasons: [`reviewed ${reviewedHead}, ready ${binding.targetHead}`]
    });
  }
}
