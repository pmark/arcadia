import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import type { ProviderSignInStatus } from "../codingAgents/signIn.js";
import { writeTransaction } from "../db/connection.js";
import { getProjectMetadata } from "../db/repositories.js";
import { listProjectsInSchedulingOrder, recordFailedRun, runSchedulingPass, type BoardFactory, type SchedulingPassResult } from "../scheduling/scheduler.js";
import { getSchedulingProject } from "../scheduling/store.js";
import { git, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { PRODUCTION_CONTROL_DEADLINES, readProductionPolicySafely } from "./policy.js";
import { getRepositoryLease, resolveProjectTransition, systemTmux, type TmuxAdapter } from "../sessions/index.js";
import { launchGuardedHostSession } from "../sessions/launch.js";
import { reconcileSessionExit } from "../sessions/reconciliation.js";
import { observeSessionActivity } from "./stallDetection.js";
import { activateNextPlan } from "../dispatch/planActivationApply.js";
import { handoffIntegrated, integrateSessionCandidate, operatorMergeCommand, preserveSessionCandidate, type IntegrateSessionDeps, type PreserveSessionDeps, type SessionHandoffResult } from "./sessionHandoff.js";
import { createId } from "../utils/id.js";

/**
 * The continuous half of managed production: on every worker tick, while the
 * standing policy is Active, reconcile any repository whose Session died
 * without being observed, flag (never reconcile) a live Session whose tmux
 * has stopped showing any real progress, admit and launch the next eligible
 * Action for every other eligible repository, and independently notice when a
 * repository's base branch moved for a reason this tick did not itself cause
 * (a human or another host merged its PR). This module owns none of the primitives it
 * calls -- admission, launch, and reconciliation are exactly the same calls a
 * human-triggered `arcadia advance`/`session launch` already makes -- it only
 * decides, once per tick, which repository each of those calls applies to,
 * and remembers how many times a repository has failed in a row so a broken
 * Action stops retrying instead of looping forever on tokens.
 */

export interface ManagedProductionTickOptions {
  profiles: CodingAgentProfile[];
  adapters: ProviderAdapterRegistry;
  now?: Date;
  tmux?: TmuxAdapter;
  /** Test-only override for the standing-policy provider capacity observation. */
  capacityObservation?: ProviderCapacityObservation;
  /** Test-only override for where a newly launched agent worktree is created. */
  agentWorktreeRoot?: string;
  /** Test-only override for the provider sign-in preflight; defaults to `checkProviderSignIn`. */
  providerSignIn?: (provider: string) => ProviderSignInStatus | null;
  /**
   * Re-stamp the preservation transport heartbeat between per-Project steps.
   * The tick blocks the event loop for minutes, so the worker's own 5s timer
   * cannot fire while it runs; this is how the 15s freshness window survives.
   */
  heartbeat?: () => void;
  log?: (message: string) => void;
  /** Override how a Project's GitHub board is reached; tests pass an in-memory board. */
  boardFactory?: BoardFactory;
  /** Test overrides for the terminal-session preservation/integration handoff. */
  handoff?: { preserve?: PreserveSessionDeps; integrate?: IntegrateSessionDeps };
}

export interface BaseBranchAdvanceObservation {
  changed: boolean;
  previousSha: string | null;
  newSha: string;
  baseBranch: string;
}

export type ManagedProductionLaunchOutcome =
  | "launched"
  | "reused"
  | "refused"
  | "failed"
  | "repair_budget_exhausted"
  | "skipped";

export interface ManagedProductionLaunchAttempt {
  attempted: boolean;
  outcome: ManagedProductionLaunchOutcome;
  reason: string;
  actionKey: string | null;
}

export interface ManagedProductionTickProjectResult {
  projectSlug: string;
  repositoryRoot: string | null;
  baseBranchAdvance: BaseBranchAdvanceObservation | null;
  reconciled: Array<{ sessionId: string; outcome: string }>;
  handoff: SessionHandoffResult | null;
  launch: ManagedProductionLaunchAttempt | null;
}

export interface ManagedProductionTickResult {
  policyActive: boolean;
  /** The scheduling pass that ran before admission, when the policy was Active. */
  scheduling: SchedulingPassResult | null;
  schedulingError: string | null;
  projects: ManagedProductionTickProjectResult[];
}

export function ensureProductionTickTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_repair_attempts (
      action_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_attempt_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_base_branch_observations (
      project_slug TEXT PRIMARY KEY,
      project_id TEXT,
      repository_path TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      observed_sha TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );
  `);
  ensureProductionLaunchBlockersTable(db);
}

/**
 * A `arcadia production status` read runs on a read-only connection and
 * cannot create a missing table itself, so this is also wired into
 * `applyMigrations` (unlike the two ad hoc tables above, which only their own
 * write paths touch) -- a fresh workspace has it before the worker ever ticks.
 */
export function ensureProductionLaunchBlockersTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_launch_blockers (
      project_slug TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      reason TEXT NOT NULL,
      action_key TEXT,
      observed_at TEXT NOT NULL
    );
  `);
}

/**
 * Packet-lifecycle kinds (see `resolvePacketLifecycle`) whose remedy needs an
 * operator or agent action, never the passage of time. `planning_approval_pending`
 * and `planning_in_progress` are excluded on purpose: both already carry an
 * open Decision, which is already operator-visible through Review. Only
 * `planning_required` has no other surface today -- nothing has asked for
 * planning yet, so silently retrying the same launch forever (Issue #576)
 * never gets anyone's attention.
 */
const NON_SELF_RESOLVING_PACKET_LIFECYCLE_KINDS = new Set<string>(["planning_required"]);

/**
 * Record (or refresh) a launch refusal that will not resolve on its own.
 * Returns true only the first time this action key is recorded, so the
 * caller can surface a signal once per continuous episode instead of on
 * every tick -- the row itself, not a fresh notification each tick, is the
 * durable, operator-visible fact.
 */
function recordOperatorEscalation(
  db: Database.Database,
  input: { actionKey: string; kind: string; message: string; remedy: string | null; now: Date }
): boolean {
  const at = input.now.toISOString();
  const existing = db.prepare("SELECT action_key FROM production_operator_escalations WHERE action_key = ?").get(input.actionKey) as
    | { action_key: string }
    | undefined;
  db.prepare(
    `INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
       VALUES (@action_key, @kind, @message, @remedy, @at, @at)
     ON CONFLICT(action_key) DO UPDATE SET
       kind = @kind, message = @message, remedy = @remedy, last_seen_at = @at`
  ).run({ action_key: input.actionKey, kind: input.kind, message: input.message, remedy: input.remedy, at });
  return !existing;
}

/** Clear a previously recorded escalation once its Action launches or its refusal stops being non-self-resolving. */
function clearOperatorEscalation(db: Database.Database, actionKey: string): void {
  db.prepare("DELETE FROM production_operator_escalations WHERE action_key = ?").run(actionKey);
}

/**
 * Drop any escalation left over from a *different* Action in this Project.
 * `recordOperatorEscalation`/`clearOperatorEscalation` only ever touch the
 * actionKey the current tick is looking at, so an Action that stops being
 * current by some other route -- the pointer advances, or it is marked done
 * through a `complete` Agent Ask rather than through this tick's own launch
 * success -- would otherwise leave a stale row that `listOperatorEscalations`
 * keeps reporting forever. Called with the Project's live actionKey (or
 * `null` when nothing is currently dispatchable), so it always reconciles
 * against the one actionKey this tick knows to be current.
 */
function pruneStaleOperatorEscalations(db: Database.Database, projectSlug: string, currentActionKey: string | null): void {
  db.prepare("DELETE FROM production_operator_escalations WHERE action_key LIKE ? AND action_key != ?").run(
    `${projectSlug}/%`,
    currentActionKey ?? ""
  );
}

export interface OperatorEscalation {
  actionKey: string;
  kind: string;
  message: string;
  remedy: string | null;
  firstDetectedAt: string;
  lastSeenAt: string;
}

/**
 * Every currently unresolved non-self-resolving launch refusal, oldest first.
 * Unlike `listRecentBaseBranchAdvances` this is not a historical log to page
 * through -- rows are deleted on resolution and pruned when stale (see
 * `pruneStaleOperatorEscalations`), so the live set is always small, and a
 * page limit would only silently hide escalations past an arbitrary cutoff.
 *
 * Deliberately does not call `ensureProductionTickTables`: this is read
 * through `arcadia production status`'s read-only connection, which cannot
 * run a `CREATE TABLE` migration. `production_operator_escalations` lives in
 * `db/schema.ts` instead of here for exactly that reason -- it is applied on
 * every writable open, so it already exists by the time any read-only open
 * is possible against a workspace created *after* this table shipped. A
 * workspace whose database predates it has no writable open to have run that
 * migration yet either, so "no such table" here means the same thing a
 * successful, empty query would: no escalation has been recorded.
 */
export function listOperatorEscalations(db: Database.Database): OperatorEscalation[] {
  let rows: Array<{
    action_key: string;
    kind: string;
    message: string;
    remedy: string | null;
    first_detected_at: string;
    last_seen_at: string;
  }>;
  try {
    rows = db
      .prepare(
        `SELECT action_key, kind, message, remedy, first_detected_at, last_seen_at
           FROM production_operator_escalations
          ORDER BY first_detected_at ASC`
      )
      .all() as typeof rows;
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return [];
    throw error;
  }
  return rows.map((row) => ({
    actionKey: row.action_key,
    kind: row.kind,
    message: row.message,
    remedy: row.remedy,
    firstDetectedAt: row.first_detected_at,
    lastSeenAt: row.last_seen_at
  }));
}

/**
 * Whether the standing policy authorizes managing `projectSlug` right now.
 * Re-read rather than snapshotted: the tick blocks for minutes between the
 * scheduling pass and each Project, so a policy narrowed mid-tick must apply to
 * the Projects not yet processed. With no Active policy there is no scope
 * filter and every active Project is eligible.
 */
function projectInActiveScope(db: Database.Database, projectSlug: string): boolean {
  const read = readProductionPolicySafely(db);
  if (read.status !== "ok" || read.policy.desiredState !== "active") return true;
  return (read.policy.scope?.projects ?? []).includes(projectSlug);
}

/**
 * Run one managed-production tick across every active Project. Never throws
 * for an individual repository's failure -- a broken or refused repository is
 * reported in its own result entry so one Project's trouble never stops the
 * tick from reaching the rest.
 */
export function runManagedProductionTick(
  db: Database.Database,
  workspace: string,
  options: ManagedProductionTickOptions
): ManagedProductionTickResult {
  ensureProductionTickTables(db);
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const tmux = options.tmux ?? systemTmux;
  const policyRead = readProductionPolicySafely(db);
  const active = policyRead.status === "ok" && policyRead.policy.desiredState === "active";

  // When a standing policy is Active, its scope names the only Projects the
  // worker is authorized to launch in. Base-branch observation and launch are
  // production management, so both stay inside that scope: an out-of-scope
  // Project is never previewed and never produces a misleading "not ready"
  // refusal. Reconciliation of an already-live Session is a safety path, not
  // management, so it still runs for every active Project and a Session that
  // predates the current grant is never left unreconciled.

  // Scheduling runs first: reconcile each linked GitHub board and point every
  // Project at its canonical next Action, so admission below launches what the
  // queue says rather than whatever the pointer last happened to name.
  let scheduling: SchedulingPassResult | null = null;
  let schedulingError: string | null = null;
  if (active) {
    try {
      scheduling = runSchedulingPass(db, { now, log, boardFactory: options.boardFactory });
    } catch (error) {
      schedulingError = error instanceof Error ? error.message : String(error);
      log(`Scheduling pass failed: ${schedulingError}`);
    }
    options.heartbeat?.();
  }

  const projects: ManagedProductionTickProjectResult[] = [];
  for (const project of listProjectsInSchedulingOrder(db)) {
    options.heartbeat?.();
    const metadata = getProjectMetadata(db, project.id);
    const configuredPath = metadata?.repo_path?.trim() || null;
    if (!configuredPath || !existsSync(configuredPath)) {
      projects.push({ projectSlug: project.slug, repositoryRoot: null, baseBranchAdvance: null, reconciled: [], handoff: null, launch: null });
      continue;
    }
    const repoRoot = path.resolve(configuredPath);

    let baseBranchAdvance: BaseBranchAdvanceObservation | null = null;
    if (projectInActiveScope(db, project.slug)) {
      try {
        baseBranchAdvance = detectBaseBranchAdvance(db, { repoRoot, projectSlug: project.slug, projectId: project.id, now, log });
      } catch (error) {
        log(`Base branch observation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
        baseBranchAdvance = null;
      }
    }
    options.heartbeat?.();

    const reconciled: Array<{ sessionId: string; outcome: string }> = [];
    let handoff: SessionHandoffResult | null = null;
    try {
      const lease = getRepositoryLease(db, repoRoot);
      if (lease && !tmux.hasSession(lease.tmux_session_name)) {
        // Preserve the dead Session's candidate before reconciliation marks it
        // terminal (validation runs against the still-active lease), then
        // reconcile through the canonical completion/pointer writers, then
        // integrate the branch -- now carrying the completion settlement --
        // only under Decision 0058's separately recorded grant. Absent a valid
        // grant this stops after preservation and reports the operator merge.
        const preservation = preserveSessionCandidate({ db, workspace, repoRoot, session: lease, now }, options.handoff?.preserve ?? {});
        const result = reconcileSessionExit({ db, sessionId: lease.id, requestId: `worker-tick-reconcile-${lease.id}`, repoRoot });
        // Integrate only a candidate whose governed completion actually settled
        // this tick. Without that, fast-forwarding the branch would land the
        // agent's work on the base branch while the pointer still names the same
        // Action, and the next tick would re-admit it. An unfinished or failed
        // Session is preserved and reported, never merged.
        const completed = result.receipt.outcome === "accepted_completion";
        const integration = preservation.kind === "preserved" && completed
          ? integrateSessionCandidate({ db, workspace, repoRoot, session: lease, now }, options.handoff?.integrate ?? {})
          : {
              kind: "refused" as const,
              reason: preservation.kind === "preserved"
                ? `Integration waits on a governed completion; reconciliation outcome was ${result.receipt.outcome}.`
                : `Integration waits on a preserved candidate: ${preservation.reason}`,
              operatorMergeCommand: preservation.kind === "preserved"
                ? operatorMergeCommand({ repoRoot, branch: lease.branch, baseBranch: preservation.baseBranch })
                : null
            };
        handoff = { preservation, integration };
        reconciled.push({ sessionId: lease.id, outcome: result.receipt.outcome });
        log(`Reconciled Session ${lease.id} for ${project.slug}: ${result.receipt.outcome} (${result.receipt.reason})`);
        if (result.receipt.outcome === "failed_execution" || result.receipt.outcome === "missing_evidence") {
          const budget = recordFailedRun(db, project.slug, { reason: `Session ${lease.id}: ${result.receipt.reason}`, actionKey: `${project.slug}/${lease.action_id}` });
          if (budget.paused) log(`Paused ${project.slug}: failed-Run budget exceeded (${budget.failedRuns}); Decision ${budget.decisionId} opened.`);
        }
      } else if (lease) {
        // tmux is alive; check whether it is actually moving. Neither branch
        // here touches `lease`/`status`, so the repository lease this Session
        // holds is untouched either way -- a suspected stall is surfaced, not
        // reconciled. The flag write and its event are one transaction: if the
        // event insert failed after the flag alone committed, a later tick
        // would see `stall_flagged_at` already set and never retry the event.
        const activity = writeTransaction(db, () => {
          const observed = observeSessionActivity(db, lease, tmux, now, PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs);
          if (observed.newlyStalled) {
            recordEvent(db, {
              eventType: "managed_production.session_stalled",
              projectId: project.id,
              payload: { projectSlug: project.slug, sessionId: lease.id, actionId: lease.action_id, tmuxSessionName: lease.tmux_session_name },
              at: now.toISOString()
            });
          }
          return observed;
        });
        if (activity.newlyStalled) {
          log(
            `Session ${lease.id} for ${project.slug} has shown no new tmux pane output and no new Run/receipt activity for ` +
              `${PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs}ms; flagged stalled. Its repository lease is preserved, pending operator review or bounded repair.`
          );
        } else if (activity.recovered) {
          log(`Session ${lease.id} for ${project.slug} resumed activity; its stalled flag is cleared.`);
        }
      }
    } catch (error) {
      log(`Reconciliation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }

    let launch: ManagedProductionLaunchAttempt | null = null;
    // Re-read the policy: the tick can block for minutes between the scheduling
    // pass and this Project's launch decision, so a grant narrowed mid-tick
    // must take effect here rather than being frozen at the tick's start.
    const launchInScope = projectInActiveScope(db, project.slug);
    const mayLaunch = active && launchInScope;
    if (active && !launchInScope) {
      // Outside the standing grant: no preview, no admission, no refusal line.
      // Nothing is resolved or spawned for it here; the reconciliation above
      // has already done the only work an out-of-scope Project is owed.
      launch = {
        attempted: false,
        outcome: "skipped",
        reason: "Project is outside the standing production policy scope; production does not launch here.",
        actionKey: null
      };
    } else if (mayLaunch && reconciled.length === 0) {
      launch = attemptProjectLaunch(db, { workspace, repoRoot, projectSlug: project.slug, options, tmux, now, log });
    } else if (mayLaunch && handoff !== null && handoffIntegrated(handoff)) {
      // The candidate is preserved and its exact branch is now on the governed
      // base branch, carrying the completion and pointer settlement. Admit the
      // next eligible Action in this same tick -- no operator command, no
      // one-tick wait.
      launch = attemptProjectLaunch(db, { workspace, repoRoot, projectSlug: project.slug, options, tmux, now, log });
    } else if (mayLaunch) {
      const refusal = handoff?.integration.kind === "refused" ? handoff.integration : null;
      if (refusal?.operatorMergeCommand) {
        log(`Candidate for ${project.slug} preserved but not integrated: ${refusal.reason} Operator merge: ${refusal.operatorMergeCommand}`);
      }
      // A Session for this repository was just reconciled this very tick. Its
      // outcome (e.g. `accepted_completion`) may have settled onto the
      // candidate's own branch, which has not been merged into this checked-in
      // repository yet -- `resolveProjectTransition` would still see the same
      // pre-completion pointer and relaunch the identical Action a second
      // time. Give the operator (or bound CI) a full tick to land that merge
      // before this repository is considered for another launch; the next
      // tick's base-branch-advance detection picks it up as soon as it lands.
      launch = { attempted: false, outcome: "skipped", reason: "Repository was just reconciled this tick; deferring admission one tick for its merge to land.", actionKey: null };
    }

    options.heartbeat?.();
    projects.push({ projectSlug: project.slug, repositoryRoot: repoRoot, baseBranchAdvance, reconciled, handoff, launch });
  }

  return { policyActive: active, scheduling, schedulingError, projects };
}

function attemptProjectLaunch(
  db: Database.Database,
  input: {
    workspace: string;
    repoRoot: string;
    projectSlug: string;
    options: ManagedProductionTickOptions;
    tmux: TmuxAdapter;
    now: Date;
    log: (message: string) => void;
  }
): ManagedProductionLaunchAttempt {
  const lease = getRepositoryLease(db, input.repoRoot);
  if (lease) {
    return { attempted: false, outcome: "skipped", reason: `Repository lease held by Session ${lease.id}.`, actionKey: null };
  }
  const paused = getSchedulingProject(db, input.projectSlug).pausedReason;
  if (paused) {
    return { attempted: false, outcome: "skipped", reason: `Scheduling is paused: ${paused}`, actionKey: null };
  }

  let transition = resolveProjectTransition({ repoRoot: input.repoRoot, projectSlug: input.projectSlug, db, tmux: input.tmux });
  if (transition.kind === "activate" && transition.activation?.candidate) {
    // Decision 0048: the active Plan cannot continue, but the explicit queue
    // names exactly one approved Plan and Action. Activate it in this same tick
    // and re-resolve, so production continues without an operator round trip.
    // `git` throws on a repository with no commits yet; keep it inside the try
    // so one Project's Git failure cannot stop the whole tick.
    try {
      const requestId = `worker-activate-${input.projectSlug}-${git(input.repoRoot, ["rev-parse", "HEAD"]).trim()}`;
      activateNextPlan(db, { repoRoot: input.repoRoot, projectSlug: input.projectSlug, requestId, apply: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.log(`Plan activation failed for ${input.projectSlug}: ${message}`);
      return { attempted: true, outcome: "failed", reason: `Plan activation failed: ${message}`, actionKey: null };
    }
    transition = resolveProjectTransition({ repoRoot: input.repoRoot, projectSlug: input.projectSlug, db, tmux: input.tmux });
  }
  if (transition.kind !== "launch" || !transition.dispatch.context) {
    // `dispatch` is resolved before the lease/competing-run check that
    // produces "wait"/"reconcile" (see `resolveProjectTransition`), so its
    // context still names the selected Action even when this tick cannot
    // launch it this instant. Preserve that Action's own escalation, if any,
    // rather than treating a transient wait as though the pointer moved on;
    // only a transition with no resolvable Action at all (a Plan boundary)
    // has nothing to preserve.
    const currentActionKey = transition.dispatch.context ? `${input.projectSlug}/${transition.dispatch.context.action.id}` : null;
    pruneStaleOperatorEscalations(db, input.projectSlug, currentActionKey);
    return { attempted: false, outcome: "skipped", reason: transition.reason, actionKey: null };
  }

  const actionKey = `${input.projectSlug}/${transition.dispatch.context.action.id}`;
  pruneStaleOperatorEscalations(db, input.projectSlug, actionKey);
  const attempts = getRepairAttempts(db, actionKey);
  if (attempts.attempts >= PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction) {
    return {
      attempted: false,
      outcome: "repair_budget_exhausted",
      reason: `Repair budget exhausted for ${actionKey} after ${attempts.attempts} failed launch attempt(s); most recent error: ${attempts.lastError ?? "unknown"}. An operator must repair and reset it.`,
      actionKey
    };
  }

  const requestId = `worker-tick-${actionKey.replaceAll("/", "-")}-${input.now.getTime()}`;
  try {
    const result = launchGuardedHostSession({
      db,
      workspace: input.workspace,
      repoRoot: input.repoRoot,
      projectSlug: input.projectSlug,
      requestId,
      standingPolicy: true,
      profiles: input.options.profiles,
      adapters: input.options.adapters,
      now: input.now,
      tmux: input.tmux,
      capacityObservation: input.options.capacityObservation,
      agentWorktreeRoot: input.options.agentWorktreeRoot,
      providerSignIn: input.options.providerSignIn,
      // Clear a stale sign-in blocker the moment sign-in is confirmed, not
      // only on full launch success: a later, unrelated launch failure (a
      // repair-worthy defect, counted against the budget) must not leave
      // `arcadia production status` still telling the operator to sign in.
      onProviderSignInConfirmed: () => clearLaunchBlocker(db, input.projectSlug)
    });
    resetRepairAttempts(db, actionKey);
    clearLaunchBlocker(db, input.projectSlug);
    clearOperatorEscalation(db, actionKey);
    input.log(`${result.reused ? "Reused" : "Launched"} Session ${result.session.id} for ${actionKey} under the standing production policy.`);
    return {
      attempted: true,
      outcome: result.reused ? "reused" : "launched",
      reason: result.reused ? "An already-durable Session satisfied this tick's launch." : "Launched under the standing production policy grant.",
      actionKey
    };
  } catch (error) {
    // A refusal carries `details.conflict`: capacity/Off/stale-preview/lease
    // races are expected wait states this tick will simply retry later, never
    // a repair-worthy failure. Anything else is a real defect in preparing or
    // spawning the Session and counts against the finite repair budget.
    if (error instanceof ArcadiaError && error.details?.conflict) {
      const rawCode = typeof error.details?.code === "string" ? error.details.code : null;
      // A signed-out provider is a durable Project launch blocker -- unlike
      // capacity/Off/stale-preview/lease conflicts, it will not resolve on its
      // own the next time this tick runs, so it is worth surfacing in
      // `arcadia production status` rather than only this log line. Any other
      // conflict code supersedes and clears a stale sign-in blocker.
      if (rawCode === "provider_not_signed_in") {
        recordLaunchBlocker(db, { projectSlug: input.projectSlug, code: rawCode, reason: error.message, actionKey, at: input.now });
      } else {
        clearLaunchBlocker(db, input.projectSlug);
      }
      const code = rawCode ? ` [${rawCode}]` : "";
      input.log(`Launch refused for ${actionKey}${code}: ${error.message}`);
      const packetLifecycleKind = typeof error.details?.packetLifecycleKind === "string" ? error.details.packetLifecycleKind : null;
      if (packetLifecycleKind && NON_SELF_RESOLVING_PACKET_LIFECYCLE_KINDS.has(packetLifecycleKind)) {
        const remedy = typeof error.details?.packetLifecycleRemedy === "string" ? error.details.packetLifecycleRemedy : null;
        const newlyDetected = recordOperatorEscalation(db, {
          actionKey,
          kind: packetLifecycleKind,
          message: error.message,
          remedy,
          now: input.now
        });
        if (newlyDetected) {
          input.log(`Escalated ${actionKey} to the operator (${packetLifecycleKind}): ${remedy ?? error.message}`);
        }
      } else {
        clearOperatorEscalation(db, actionKey);
      }
      return { attempted: true, outcome: "refused", reason: error.message, actionKey };
    }
    const message = error instanceof Error ? error.message : String(error);
    recordRepairAttempt(db, actionKey, message, input.now);
    recordFailedRun(db, input.projectSlug, { reason: `Launch failed for ${actionKey}: ${message}`, actionKey });
    input.log(`Launch attempt failed for ${actionKey}: ${message}`);
    return { attempted: true, outcome: "failed", reason: message, actionKey };
  }
}

interface RepairAttemptsRow {
  attempts: number;
  last_error: string | null;
}

function getRepairAttempts(db: Database.Database, actionKey: string): { attempts: number; lastError: string | null } {
  const row = db.prepare("SELECT attempts, last_error FROM production_repair_attempts WHERE action_key = ?").get(actionKey) as
    | RepairAttemptsRow
    | undefined;
  return { attempts: row?.attempts ?? 0, lastError: row?.last_error ?? null };
}

function recordRepairAttempt(db: Database.Database, actionKey: string, error: string, now: Date): void {
  const at = now.toISOString();
  const existing = db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get(actionKey) as
    | { attempts: number }
    | undefined;
  const attempts = (existing?.attempts ?? 0) + 1;
  db.prepare(
    `INSERT INTO production_repair_attempts (action_key, attempts, last_error, last_attempt_at, updated_at)
       VALUES (@action_key, @attempts, @last_error, @last_attempt_at, @updated_at)
     ON CONFLICT(action_key) DO UPDATE SET
       attempts = @attempts, last_error = @last_error, last_attempt_at = @last_attempt_at, updated_at = @updated_at`
  ).run({ action_key: actionKey, attempts, last_error: error, last_attempt_at: at, updated_at: at });
}

function resetRepairAttempts(db: Database.Database, actionKey: string): void {
  db.prepare("DELETE FROM production_repair_attempts WHERE action_key = ?").run(actionKey);
}

/**
 * Reset a repository's exhausted repair budget after an operator has fixed
 * the underlying problem, so the next tick attempts admission again rather
 * than reporting the same stale error forever.
 */
export function resetProductionRepairBudget(db: Database.Database, actionKey: string): void {
  ensureProductionTickTables(db);
  resetRepairAttempts(db, actionKey);
}

function detectBaseBranchAdvance(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; projectId: string; now: Date; log: (message: string) => void }
): BaseBranchAdvanceObservation | null {
  const baseBranch = resolveBaseBranch(input.repoRoot);
  // Fetch and fast-forward the local base branch onto its remote when that is
  // a clean ancestor merge, mirroring `go.ts`'s own `syncBaseBranchWithRemote`
  // -- without this, a PR merged by a human or CI elsewhere never becomes
  // visible here, because `git fetch` alone only updates the remote-tracking
  // ref, not the local branch this repository actually dispatches against.
  // `--ff-only` refuses (leaving everything untouched) on any divergence or
  // conflicting local change, so a tick can attempt this every time with no
  // risk of rewriting or discarding work.
  if (tryGit(input.repoRoot, ["fetch", "--quiet", "origin"]) !== null) {
    tryGit(input.repoRoot, ["merge", "--ff-only", "--quiet", `origin/${baseBranch}`]);
  }
  const newSha = git(input.repoRoot, ["rev-parse", baseBranch]).trim();
  const at = input.now.toISOString();

  const existing = db.prepare("SELECT observed_sha FROM production_base_branch_observations WHERE project_slug = ?").get(input.projectSlug) as
    | { observed_sha: string }
    | undefined;
  const previousSha = existing?.observed_sha ?? null;

  db.prepare(
    `INSERT INTO production_base_branch_observations (project_slug, project_id, repository_path, base_branch, observed_sha, observed_at)
       VALUES (@project_slug, @project_id, @repository_path, @base_branch, @observed_sha, @observed_at)
     ON CONFLICT(project_slug) DO UPDATE SET
       project_id = @project_id, repository_path = @repository_path, base_branch = @base_branch,
       observed_sha = @observed_sha, observed_at = @observed_at`
  ).run({
    project_slug: input.projectSlug,
    project_id: input.projectId,
    repository_path: input.repoRoot,
    base_branch: baseBranch,
    observed_sha: newSha,
    observed_at: at
  });

  if (previousSha === null || previousSha === newSha) {
    return { changed: false, previousSha, newSha, baseBranch };
  }

  // The durable record of an advance is the `events` row above plus the
  // `production_base_branch_observations` dedup row. Nothing is written to
  // MISSION_LOG.md and no commit is made: routine machine telemetry does not
  // belong in the human narrative, its date-only heading collides with every
  // advance on the same day so `docs sync` rejects the whole file, and the
  // per-advance commit rewrote history without anyone asking. The observation
  // itself is visible through `arcadia production status`.
  recordEvent(db, {
    eventType: "managed_production.base_branch_advanced",
    projectId: input.projectId,
    payload: { projectSlug: input.projectSlug, baseBranch, previousSha, newSha, repositoryPath: input.repoRoot },
    at
  });
  input.log(`Base branch ${baseBranch} advanced for ${input.projectSlug} (a merge landed independent of this worker's own admission pipeline): ${previousSha} -> ${newSha}`);
  return { changed: true, previousSha, newSha, baseBranch };
}

export interface BaseBranchAdvanceRecord {
  projectSlug: string;
  baseBranch: string;
  previousSha: string | null;
  newSha: string;
  observedAt: string;
}

/**
 * Read-only projection of the durable base-advance events, newest first, so a
 * human can see a merge that landed without a Mission Log entry. This is the
 * only surface `detectBaseBranchAdvance` records to besides the event row and
 * its dedup row.
 */
export function listRecentBaseBranchAdvances(db: Database.Database, limit = 10): BaseBranchAdvanceRecord[] {
  const rows = db
    .prepare(
      `SELECT payload_json, created_at
         FROM events
        WHERE event_type = 'managed_production.base_branch_advanced'
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(limit) as Array<{ payload_json: string; created_at: string }>;

  const records: BaseBranchAdvanceRecord[] = [];
  for (const row of rows) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    records.push({
      projectSlug: typeof payload.projectSlug === "string" ? payload.projectSlug : "unknown",
      baseBranch: typeof payload.baseBranch === "string" ? payload.baseBranch : "unknown",
      previousSha: typeof payload.previousSha === "string" ? payload.previousSha : null,
      newSha: typeof payload.newSha === "string" ? payload.newSha : "unknown",
      observedAt: row.created_at
    });
  }
  return records;
}

export interface LaunchBlockerRecord {
  projectSlug: string;
  code: string;
  reason: string;
  actionKey: string | null;
  observedAt: string;
}

/**
 * Persist why `projectSlug` is not launching right now, so `arcadia
 * production status` can show the Project launch blocker instead of it
 * existing only as a line in the worker log. Overwrites any prior blocker for
 * the same Project: only the current reason is durable, not a history.
 */
function recordLaunchBlocker(
  db: Database.Database,
  input: { projectSlug: string; code: string; reason: string; actionKey: string | null; at: Date }
): void {
  ensureProductionLaunchBlockersTable(db);
  db.prepare(
    `INSERT INTO production_launch_blockers (project_slug, code, reason, action_key, observed_at)
       VALUES (@project_slug, @code, @reason, @action_key, @observed_at)
     ON CONFLICT(project_slug) DO UPDATE SET
       code = @code, reason = @reason, action_key = @action_key, observed_at = @observed_at`
  ).run({
    project_slug: input.projectSlug,
    code: input.code,
    reason: input.reason,
    action_key: input.actionKey,
    observed_at: input.at.toISOString()
  });
}

/** Clears a Project's recorded launch blocker once it stops applying. */
function clearLaunchBlocker(db: Database.Database, projectSlug: string): void {
  ensureProductionLaunchBlockersTable(db);
  db.prepare("DELETE FROM production_launch_blockers WHERE project_slug = ?").run(projectSlug);
}

/**
 * Read-only projection of every Project's current launch blocker, for
 * `arcadia production status`. A Project absent here is not currently
 * refused for a durable reason -- it may simply not have been considered yet.
 *
 * `arcadia production status` opens the database read-only and never applies
 * migrations itself, so a workspace whose database predates this table (and
 * has had no writable connection open since) would otherwise see this throw
 * "no such table" instead of an empty, honest status. Guard on
 * `sqlite_master` rather than assuming the table always exists.
 */
export function listLaunchBlockers(db: Database.Database): LaunchBlockerRecord[] {
  const tableExists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_launch_blockers'`)
    .get();
  if (!tableExists) return [];

  const rows = db
    .prepare(
      `SELECT project_slug, code, reason, action_key, observed_at
         FROM production_launch_blockers
        ORDER BY observed_at DESC`
    )
    .all() as Array<{ project_slug: string; code: string; reason: string; action_key: string | null; observed_at: string }>;
  return rows.map((row) => ({
    projectSlug: row.project_slug,
    code: row.code,
    reason: row.reason,
    actionKey: row.action_key,
    observedAt: row.observed_at
  }));
}

function recordEvent(db: Database.Database, input: { eventType: string; projectId: string | null; payload: unknown; at: string }): void {
  db.prepare(
    `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
       VALUES (@id, @event_type, 'managed_production_tick', @project_id, NULL, NULL, NULL, @payload_json, @created_at)`
  ).run({
    id: createId("event"),
    event_type: input.eventType,
    project_id: input.projectId,
    payload_json: JSON.stringify({ schemaVersion: 1, ...input.payload as object }),
    created_at: input.at
  });
}
