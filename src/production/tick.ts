import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import type { ProviderAdapterRegistry } from "../codingAgents/providerAdapters.js";
import { type ProviderCapacityObservation } from "../codingAgents/capacity.js";
import { getProjectMetadata } from "../db/repositories.js";
import { listProjectsInSchedulingOrder, recordFailedRun, runSchedulingPass, type BoardFactory, type SchedulingPassResult } from "../scheduling/scheduler.js";
import { getSchedulingProject } from "../scheduling/store.js";
import { git, resolveBaseBranch, tryGit } from "../git/worktrees.js";
import type { CodingAgentProfile } from "../intent/registries.js";
import { PRODUCTION_CONTROL_DEADLINES, readProductionPolicySafely } from "./policy.js";
import { getRepositoryLease, resolveProjectTransition, systemTmux, type AgentSession, type TmuxAdapter } from "../sessions/index.js";
import { launchGuardedHostSession } from "../sessions/launch.js";
import { reconcileSessionExit } from "../sessions/reconciliation.js";
import { activateNextPlan } from "../dispatch/planActivationApply.js";
import { handoffIntegrated, integrateSessionCandidate, operatorMergeCommand, preserveSessionCandidate, type IntegrateSessionDeps, type PreserveSessionDeps, type SessionHandoffResult } from "./sessionHandoff.js";
import { createId } from "../utils/id.js";

/**
 * The continuous half of managed production: on every worker tick, while the
 * standing policy is Active, reconcile any repository whose Session died
 * without being observed, admit and launch the next eligible Action for every
 * other eligible repository, and independently notice when a repository's
 * base branch moved for a reason this tick did not itself cause (a human or
 * another host merged its PR). This module owns none of the primitives it
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
  /** Null unless a live Session was observed this tick; see `detectSessionStall`. */
  stall: SessionStallObservation | null;
}

export interface SessionStallObservation {
  sessionId: string;
  actionKey: string;
  /** True once this Session has been continuously unchanged for at least the deadline. */
  stalled: boolean;
  /** True only on the tick that crosses the deadline -- the tick that recorded the event. */
  justFlagged: boolean;
  lastProgressAt: string;
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
    CREATE TABLE IF NOT EXISTS production_session_stall_observations (
      session_id TEXT PRIMARY KEY,
      project_slug TEXT NOT NULL,
      action_key TEXT NOT NULL,
      pane_hash TEXT,
      last_progress_at TEXT NOT NULL,
      flagged_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
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
      projects.push({ projectSlug: project.slug, repositoryRoot: null, baseBranchAdvance: null, reconciled: [], handoff: null, launch: null, stall: null });
      continue;
    }
    const repoRoot = path.resolve(configuredPath);

    let baseBranchAdvance: BaseBranchAdvanceObservation | null;
    try {
      baseBranchAdvance = detectBaseBranchAdvance(db, { repoRoot, projectSlug: project.slug, projectId: project.id, now, log });
    } catch (error) {
      log(`Base branch observation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
      baseBranchAdvance = null;
    }
    options.heartbeat?.();

    const reconciled: Array<{ sessionId: string; outcome: string }> = [];
    let handoff: SessionHandoffResult | null = null;
    let stall: SessionStallObservation | null = null;
    try {
      const lease = getRepositoryLease(db, repoRoot);
      const leaseLive = lease ? tmux.hasSession(lease.tmux_session_name) : false;
      if (lease && leaseLive) {
        try {
          stall = detectSessionStall(db, { lease, tmux, now, log });
        } catch (error) {
          log(`Stall observation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (lease && !leaseLive) {
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
      }
    } catch (error) {
      log(`Reconciliation failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }

    let launch: ManagedProductionLaunchAttempt | null = null;
    if (active && reconciled.length === 0) {
      launch = attemptProjectLaunch(db, { workspace, repoRoot, projectSlug: project.slug, options, tmux, now, log });
    } else if (active && handoff !== null && handoffIntegrated(handoff)) {
      // The candidate is preserved and its exact branch is now on the governed
      // base branch, carrying the completion and pointer settlement. Admit the
      // next eligible Action in this same tick -- no operator command, no
      // one-tick wait.
      launch = attemptProjectLaunch(db, { workspace, repoRoot, projectSlug: project.slug, options, tmux, now, log });
    } else if (active) {
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
    projects.push({ projectSlug: project.slug, repositoryRoot: repoRoot, baseBranchAdvance, reconciled, handoff, launch, stall });
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
    return { attempted: false, outcome: "skipped", reason: transition.reason, actionKey: null };
  }

  const actionKey = `${input.projectSlug}/${transition.dispatch.context.action.id}`;
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
      agentWorktreeRoot: input.options.agentWorktreeRoot
    });
    resetRepairAttempts(db, actionKey);
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
      const code = typeof error.details?.code === "string" ? ` [${error.details.code}]` : "";
      input.log(`Launch refused for ${actionKey}${code}: ${error.message}`);
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

interface StallObservationRow {
  pane_hash: string | null;
  last_progress_at: string;
  flagged_at: string | null;
}

/**
 * Distinguish a live-but-hung Session from one making real progress, without
 * ever touching its repository lease. `tmux.hasSession` (the dead-Session
 * check above) only answers "does the process still exist"; a hung agent's
 * tmux pane stays alive forever, so this reads the pane's own text as the
 * observable, deterministic progress signal contract 20's "Process health"
 * fault row asks for.
 *
 * A tick where the pane's content is unchanged from the previous tick is not
 * itself evidence of a stall -- an agent silently compiling for a minute
 * looks the same as one that is truly stuck. Only `sessionStallDeadlineMs` of
 * *continuously* unchanged output crosses into "flagged", and that happens at
 * most once per stall (the row's `flagged_at` gates the one `events` row this
 * emits) so the worker log and `production status` never duplicate it. Any
 * change in pane content -- including a session recovering after being
 * flagged -- resets the deadline and, if it had been flagged, records that
 * recovery too. A pane that cannot be read this tick (`capturePane` returns
 * null) is a missing observation, never a signal on its own: this function
 * leaves the previous observation untouched and reports nothing rather than
 * guessing.
 */
function detectSessionStall(
  db: Database.Database,
  input: { lease: AgentSession; tmux: Pick<TmuxAdapter, "capturePane">; now: Date; log: (message: string) => void }
): SessionStallObservation | null {
  const pane = input.tmux.capturePane(input.lease.tmux_session_name);
  if (pane === null) return null;

  const paneHash = createHash("sha256").update(pane).digest("hex");
  const at = input.now.toISOString();
  const actionKey = `${input.lease.project_slug}/${input.lease.action_id}`;

  const existing = db
    .prepare("SELECT pane_hash, last_progress_at, flagged_at FROM production_session_stall_observations WHERE session_id = ?")
    .get(input.lease.id) as StallObservationRow | undefined;

  if (!existing || existing.pane_hash !== paneHash) {
    const wasFlagged = existing?.flagged_at != null;
    db.prepare(
      `INSERT INTO production_session_stall_observations (session_id, project_slug, action_key, pane_hash, last_progress_at, flagged_at, updated_at)
         VALUES (@session_id, @project_slug, @action_key, @pane_hash, @last_progress_at, NULL, @updated_at)
       ON CONFLICT(session_id) DO UPDATE SET
         project_slug = @project_slug, action_key = @action_key, pane_hash = @pane_hash,
         last_progress_at = @last_progress_at, flagged_at = NULL, updated_at = @updated_at`
    ).run({
      session_id: input.lease.id,
      project_slug: input.lease.project_slug,
      action_key: actionKey,
      pane_hash: paneHash,
      last_progress_at: at,
      updated_at: at
    });
    if (wasFlagged) {
      recordEvent(db, {
        eventType: "managed_production.session_stall_cleared",
        projectId: input.lease.project_id,
        payload: { sessionId: input.lease.id, projectSlug: input.lease.project_slug, actionKey },
        at
      });
      input.log(`Session ${input.lease.id} for ${actionKey} resumed producing output; stall cleared.`);
    }
    return { sessionId: input.lease.id, actionKey, stalled: false, justFlagged: false, lastProgressAt: at };
  }

  const elapsedMs = input.now.getTime() - new Date(existing.last_progress_at).getTime();
  if (elapsedMs < PRODUCTION_CONTROL_DEADLINES.sessionStallDeadlineMs) {
    return { sessionId: input.lease.id, actionKey, stalled: false, justFlagged: false, lastProgressAt: existing.last_progress_at };
  }

  if (existing.flagged_at != null) {
    return { sessionId: input.lease.id, actionKey, stalled: true, justFlagged: false, lastProgressAt: existing.last_progress_at };
  }

  db.prepare("UPDATE production_session_stall_observations SET flagged_at = ?, updated_at = ? WHERE session_id = ?").run(
    at,
    at,
    input.lease.id
  );
  recordEvent(db, {
    eventType: "managed_production.session_stalled",
    projectId: input.lease.project_id,
    payload: {
      sessionId: input.lease.id,
      projectSlug: input.lease.project_slug,
      actionKey,
      lastProgressAt: existing.last_progress_at,
      deadlineMs: PRODUCTION_CONTROL_DEADLINES.sessionStallDeadlineMs
    },
    at
  });
  input.log(
    `Session ${input.lease.id} for ${actionKey} flagged stalled: no pane output change since ${existing.last_progress_at} ` +
      `(deadline ${PRODUCTION_CONTROL_DEADLINES.sessionStallDeadlineMs}ms). Lease preserved; needs operator or bounded automatic repair.`
  );
  return { sessionId: input.lease.id, actionKey, stalled: true, justFlagged: true, lastProgressAt: existing.last_progress_at };
}

export interface SessionStallRecord {
  sessionId: string;
  projectSlug: string;
  actionKey: string;
  lastProgressAt: string;
  flaggedAt: string;
}

/**
 * Read-only projection of Sessions currently flagged stalled -- pending
 * operator attention or bounded automatic repair, never silently reconciled.
 * Mirrors `listRecentBaseBranchAdvances`: the durable record is the dedup row
 * plus the `events` row `detectSessionStall` writes, surfaced here rather than
 * in MISSION_LOG.md.
 *
 * Joined against `agent_sessions` and filtered to a still-held lease: once a
 * Session actually dies, the dead-lease branch reconciles it without ever
 * calling `detectSessionStall` again, so nothing else clears `flagged_at` on
 * its observation row. Without this filter a terminated Session would stay
 * listed as "stalled, lease preserved" forever, which is simply false once
 * the lease is gone.
 */
export function listCurrentlyStalledSessions(db: Database.Database): SessionStallRecord[] {
  // The observation table is created by `ensureProductionTickTables` inside a
  // write transaction the first time a tick runs; a read-only status query
  // before that (or against a workspace that has never ticked) must not crash.
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_session_stall_observations'").get();
  if (!hasTable) return [];
  const rows = db
    .prepare(
      `SELECT o.session_id, o.project_slug, o.action_key, o.last_progress_at, o.flagged_at
         FROM production_session_stall_observations o
         JOIN agent_sessions s ON s.id = o.session_id
        WHERE o.flagged_at IS NOT NULL AND s.status IN ('prepared', 'running')
        ORDER BY o.flagged_at DESC`
    )
    .all() as Array<{ session_id: string; project_slug: string; action_key: string; last_progress_at: string; flagged_at: string }>;
  return rows.map((row) => ({
    sessionId: row.session_id,
    projectSlug: row.project_slug,
    actionKey: row.action_key,
    lastProgressAt: row.last_progress_at,
    flaggedAt: row.flagged_at
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
