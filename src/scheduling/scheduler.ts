import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { createReviewItem, getProjectBySlug, getReviewItem, listProjects } from "../db/repositories.js";
import { transitionActionPointer } from "../dispatch/pointer.js";
import type { Project } from "../domain/types.js";
import { getRepositoryLease } from "../sessions/index.js";
import { findOutstandingCandidate } from "../sessions/candidatePreservation.js";
import { resolveBatch, type BatchResolution } from "../docs/batch.js";
import { loadActionOrder } from "../dispatch/order.js";
import { createGitHubBoard, reconcileBoard, runGh, type BoardIdentity, type ReconcileResult, type SchedulingBoard } from "./github.js";
import { buildProjectSchedule, projectRepositoryRoot, type ProjectSchedule } from "./schedule.js";
import { getSchedulingProject, recordSchedulingLog, upsertSchedulingProject } from "./store.js";

/**
 * The scheduler's per-tick pass, in the order the MVP contract lists it:
 * reconcile the GitHub board, then make sure each Project's governed pointer
 * names the Action the canonical queue would run next. Launching is not done
 * here -- the production tick already launches whatever the pointer names,
 * so the scheduler's whole job is to keep the pointer honest.
 *
 * Every step is best-effort per Project and reports rather than throws: a
 * GitHub outage or a dirty repository must not stop the other Projects.
 */

export const MAX_FAILED_RUNS_PER_MILESTONE = 8;

/**
 * How long a linked board may go unread while nothing in Arcadia changes.
 *
 * The worker ticks every two seconds. Reading a board costs GraphQL points,
 * and GitHub's hourly limit is per account, so an unthrottled read per tick
 * would exhaust it and break every other `gh` call the operator makes. Arcadia
 * never needs to poll to learn about its own changes -- those bump the queue
 * revision and project immediately. Polling exists only to notice a drag,
 * which is a human action; a minute of latency on one is not worth thousands
 * of calls an hour.
 */
export const DEFAULT_BOARD_POLL_INTERVAL_MS = 60_000;

export type BoardFactory = (schedule: ProjectSchedule, db: Database.Database) => SchedulingBoard | null;

export const defaultBoardFactory: BoardFactory = (schedule, db) => {
  if (!schedule.github || !schedule.github.repository || !schedule.repositoryRoot) return null;
  const config = {
    owner: schedule.github.owner,
    number: schedule.github.number,
    repository: schedule.github.repository,
    cwd: schedule.repositoryRoot
  };
  const cached = cachedBoardIdentity(schedule);
  const board = createGitHubBoard(config, runGh, cached);
  if (!cached) {
    upsertSchedulingProject(db, schedule.projectSlug, {
      githubProjectId: board.identity.projectId,
      githubStatusFieldId: board.identity.statusFieldId,
      githubStatusOptions: board.identity.statusOptions,
      githubPushField: board.identity.pushField ?? { absent: true }
    });
  }
  return board;
};

function cachedBoardIdentity(schedule: ProjectSchedule): BoardIdentity | null {
  const record = schedule.record;
  if (!record.githubProjectId || !record.githubStatusFieldId || !record.githubStatusOptions) return null;
  // A resolved absence is a fact worth caching: re-resolving a board that has
  // no `Arcadia push` field on every poll would spend a `field-list` call per
  // minute forever. `undefined` here means "not yet resolved", which is the
  // only state that costs a call.
  if (record.githubPushField === null) return null;
  return {
    projectId: record.githubProjectId,
    statusFieldId: record.githubStatusFieldId,
    statusOptions: record.githubStatusOptions,
    pushField: "absent" in record.githubPushField ? null : record.githubPushField
  };
}

/**
 * Whether this pass should touch the Project's board at all, and why.
 *
 * Everything Arcadia itself changes is known locally, so a board read is only
 * required to publish a change or to notice an operator's drag. An idle
 * Project with a settled board needs neither.
 */
export function boardPassDecision(
  schedule: ProjectSchedule,
  now: Date,
  pollIntervalMs: number
): { touch: boolean; reason: string } {
  const record = schedule.record;
  if (record.projectionInFlight) return { touch: true, reason: "A previous projection did not finish writing to the board." };
  if (schedule.queueRevision !== record.lastProjectedRevision) return { touch: true, reason: "The queue revision moved since the last projection." };
  if (schedule.actions.some((action) => action.githubProjectItemId === null)) return { touch: true, reason: "An Action has no card on the board yet." };
  if (!record.lastReconciledAt) return { touch: true, reason: "The board has never been read." };
  const elapsed = now.getTime() - Date.parse(record.lastReconciledAt);
  if (!Number.isFinite(elapsed) || elapsed >= pollIntervalMs) {
    return { touch: true, reason: "Due for an operator-drag poll." };
  }
  return { touch: false, reason: `Board is settled and was read ${Math.round(elapsed / 1000)}s ago; next poll in ${Math.round((pollIntervalMs - elapsed) / 1000)}s.` };
}

export interface SchedulingProjectPass {
  projectSlug: string;
  next: string | null;
  currentAction: string | null;
  reconcile: ReconcileResult | null;
  reconcileError: string | null;
  /** Why this pass did not read the board, when it did not. */
  boardSkipped: string | null;
  pointer: { moved: boolean; from: string | null; to: string | null; reason: string };
  paused: string | null;
}

export interface SchedulingPassResult {
  generatedAt: string;
  /** Projects in priority order. */
  projects: SchedulingProjectPass[];
  /** The first Project with runnable work after the pass. */
  selection: { projectSlug: string; actionKey: string } | null;
}

export interface SchedulingPassOptions {
  now?: Date;
  boardFactory?: BoardFactory;
  /** Move governed pointers when the queue disagrees with them (default true). */
  alignPointers?: boolean;
  /**
   * Restrict the whole pass to these Project slugs. This is the scope of every
   * effect the pass has, not a filter on one of them: a pass scoped to one
   * Project must not reconcile another Project's board or commit another
   * Project's pointer move. Absent means every active Project.
   */
  projectSlugs?: string[];
  /** How long a settled board may go unread. Defaults to {@link DEFAULT_BOARD_POLL_INTERVAL_MS}. */
  boardPollIntervalMs?: number;
  log?: (message: string) => void;
}

/**
 * The push for the repository this schedule belongs to, computed once per pass
 * and shared by every Project in it. Built from the active Projects' configured
 * repository paths — a cheap metadata read, not a second document scan — so the
 * lanes agree with the portfolio view without adding a pass per Project.
 */
function repositoryBatch(
  db: Database.Database,
  schedule: ProjectSchedule,
  cache: Map<string, BatchResolution | null>
): BatchResolution | null {
  if (!schedule.repositoryRoot) return null;
  const cached = cache.get(schedule.repositoryRoot);
  if (cached !== undefined) return cached;

  const inputs = listProjects(db)
    .filter((project) => project.status === "active")
    .map((project) => ({ repositoryRoot: projectRepositoryRoot(db, project), projectSlug: project.slug }))
    .filter((entry): entry is { repositoryRoot: string; projectSlug: string } => entry.repositoryRoot === schedule.repositoryRoot);

  // Ordered by the same explicit priority `arcadia advance queue` dispatches
  // from, so the push a Project reports here matches what actually runs next
  // rather than just the plan document's declaration order.
  const positions = loadActionOrder(db).positions;
  const batch = resolveBatch(
    inputs.length > 0 ? inputs : [{ repositoryRoot: schedule.repositoryRoot, projectSlug: schedule.projectSlug }],
    { queuePosition: (key) => positions.get(key) ?? null }
  );
  cache.set(schedule.repositoryRoot, batch);
  return batch;
}

export function listProjectsInSchedulingOrder(db: Database.Database, projectSlugs?: string[]): Project[] {
  const scope = projectSlugs === undefined ? null : new Set(projectSlugs);
  return listProjects(db)
    .filter((project) => project.status === "active")
    .filter((project) => scope === null || scope.has(project.slug))
    .map((project) => ({ project, priority: getSchedulingProject(db, project.slug).priority }))
    .sort((left, right) => left.priority - right.priority || left.project.slug.localeCompare(right.project.slug))
    .map((entry) => entry.project);
}

export function runSchedulingPass(db: Database.Database, options: SchedulingPassOptions = {}): SchedulingPassResult {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const boardFactory = options.boardFactory ?? defaultBoardFactory;
  const pollIntervalMs = options.boardPollIntervalMs ?? DEFAULT_BOARD_POLL_INTERVAL_MS;
  const projects: SchedulingProjectPass[] = [];
  let selection: SchedulingPassResult["selection"] = null;
  // One push per repository per pass, shared by every Project in it: a lane is
  // a repository, so a Project projected from its own Actions alone would
  // label a shared lane "This push" while the dashboard says "sequence
  // advised" for the same work.
  const batchesByRepository = new Map<string, BatchResolution | null>();

  for (const project of listProjectsInSchedulingOrder(db, options.projectSlugs)) {
    let schedule = buildProjectSchedule(db, project);
    let reconcile: ReconcileResult | null = null;
    let reconcileError: string | null = null;
    let boardSkipped: string | null = null;
    if (schedule.blockers.length === 0) {
      const decision = boardPassDecision(schedule, now, pollIntervalMs);
      if (!decision.touch) {
        boardSkipped = decision.reason;
      } else {
        try {
          const board = boardFactory(schedule, db);
          if (board) {
            reconcile = reconcileBoard(db, schedule, board, {
              requestId: `scheduler-${project.slug}-${now.getTime()}`,
              rebuild: () => buildProjectSchedule(db, project),
              now,
              batch: repositoryBatch(db, schedule, batchesByRepository)
            });
            if (reconcile.operatorMoved || reconcile.projection?.changed) schedule = buildProjectSchedule(db, project);
          } else {
            boardSkipped = "No GitHub board is linked to this Project.";
          }
        } catch (error) {
          reconcileError = error instanceof Error ? error.message : String(error);
          // Drop the cached ids: a renamed, recreated or deleted field is one
          // cause of this, and a cache that never expires would keep failing
          // the same way. The next pass pays two calls to re-resolve.
          upsertSchedulingProject(db, project.slug, { githubStatusFieldId: null, githubStatusOptions: null, githubPushField: null });
          log(`GitHub reconciliation failed for ${project.slug}: ${reconcileError}`);
        }
      }
    }

    const pointer = options.alignPointers === false
      ? { moved: false, from: schedule.currentAction, to: schedule.currentAction, reason: "Pointer alignment disabled for this pass." }
      : alignPointer(db, schedule, now, log);
    if (pointer.moved) schedule = buildProjectSchedule(db, project);

    projects.push({
      projectSlug: project.slug,
      next: schedule.next,
      currentAction: schedule.currentAction,
      reconcile,
      reconcileError,
      boardSkipped,
      pointer,
      paused: schedule.pausedReason
    });
    if (!selection && schedule.next) selection = { projectSlug: project.slug, actionKey: schedule.next };
  }

  return { generatedAt: now.toISOString(), projects, selection };
}

/**
 * Move the governed pointer to the canonical next Action when it names
 * something else that is not running. Uses the same preview-then-apply
 * transition `advance queue make-next` uses, so the documents and the commit
 * are identical to what an operator would have produced by hand.
 */
function alignPointer(db: Database.Database, schedule: ProjectSchedule, now: Date, log: (message: string) => void): SchedulingProjectPass["pointer"] {
  const from = schedule.currentAction;
  const actionKey = schedule.next;
  const actionId = actionKey ? actionKey.slice(schedule.projectSlug.length + 1) : null;
  const unchanged = (reason: string) => ({ moved: false, from, to: from, reason });
  if (schedule.pausedReason) return unchanged(`Project is paused: ${schedule.pausedReason}`);
  if (!actionKey || !actionId) return unchanged("No runnable Action in the canonical queue.");
  if (from === actionId) return unchanged("The governed pointer already names the canonical next Action.");
  if (!schedule.repositoryRoot) return unchanged("No repository to write the pointer in.");
  const current = schedule.actions.find((action) => action.actionId === from);
  if (current && current.status === "running") return unchanged(`Current Action ${from} is running; the pointer moves when it finishes.`);
  if (getRepositoryLease(db, schedule.repositoryRoot)) return unchanged("A Session holds the repository lease; the pointer moves after reconciliation.");

  // A finished Session leaves its completion settlement on the candidate
  // branch, where it has already rewritten `current_action`. Until that merges,
  // the Action still reads as unfinished here, so moving the pointer in the
  // base checkout writes the same field twice from two places and collides at
  // merge. The Session is gone and the lease is released by this point, so
  // nothing above catches it; the unlanded candidate is the only signal left.
  if (from) {
    const outstanding = findOutstandingCandidate(db, { repositoryPath: schedule.repositoryRoot, actionId: from });
    if (outstanding) {
      const where = outstanding.pullRequestNumber
        ? `pull request #${outstanding.pullRequestNumber}`
        : `branch ${outstanding.branch} (${outstanding.preservationState})`;
      return unchanged(`Action ${from} has an unmerged candidate in ${where}; the pointer moves once it lands.`);
    }
  }

  const requestId = `scheduler-pointer-${actionKey.replaceAll("/", "-")}-r${schedule.queueRevision}-${now.getTime()}`;
  try {
    const preview = transitionActionPointer(db, {
      repoRoot: schedule.repositoryRoot,
      projectSlug: schedule.projectSlug,
      actionId,
      actionKey,
      queueRevision: schedule.queueRevision,
      requestId
    });
    const applied = transitionActionPointer(db, {
      repoRoot: schedule.repositoryRoot,
      projectSlug: schedule.projectSlug,
      actionId,
      actionKey,
      queueRevision: schedule.queueRevision,
      requestId,
      previewFingerprint: preview.previewFingerprint,
      apply: true
    });
    recordSchedulingLog(db, {
      projectSlug: schedule.projectSlug,
      actionKey,
      source: "arcadia",
      reason: `Scheduler selected ${actionKey} as the next runnable Action and moved the governed pointer from ${from ?? "none"}.${applied.commitError ? ` Pointer commit failed: ${applied.commitError}` : ""}`,
      previous: { currentAction: from },
      next: { currentAction: actionId, receipt: applied.id }
    });
    log(`Scheduler pointed ${schedule.projectSlug} at ${actionId} (was ${from ?? "none"}).`);
    return { moved: true, from, to: actionId, reason: "Canonical queue selected a different next Action." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Scheduler could not move the pointer for ${schedule.projectSlug}: ${message}`);
    return { moved: false, from, to: from, reason: `Pointer transition refused: ${message}` };
  }
}

export interface FailedRunRecord {
  projectSlug: string;
  failedRuns: number;
  paused: boolean;
  decisionId: string | null;
}

/**
 * The one execution-cost guard: count failed Runs per active Milestone and,
 * past the budget, pause the Project's queue and open a Decision instead of
 * retrying. The counter resets when the Project's Milestone changes.
 */
export function recordFailedRun(db: Database.Database, projectSlug: string, input: { reason: string; actionKey?: string | null }): FailedRunRecord {
  const project = getProjectBySlug(db, projectSlug);
  const milestone = project ? buildProjectSchedule(db, project).milestone : null;
  const record = getSchedulingProject(db, projectSlug);
  const failedRuns = (record.failedRunsMilestone === milestone ? record.failedRuns : 0) + 1;
  const overBudget = failedRuns > MAX_FAILED_RUNS_PER_MILESTONE;
  let decisionId: string | null = null;
  let pausedReason = record.pausedReason;
  if (overBudget && !record.pausedReason) {
    const decision = createReviewItem(db, {
      projectId: project?.id ?? null,
      decisionNeeded: `Milestone "${milestone ?? "(none)"}" of ${projectSlug} exceeded its failed-Run budget (${MAX_FAILED_RUNS_PER_MILESTONE}). Continue, retarget, or stop?`,
      recommendation: "Inspect the most recent failed Runs before granting more attempts; resume with `arcadia schedule resume`.",
      sourceInput: input.reason,
      proposedAction: "Pause automatic scheduling for this Project until an operator decides.",
      resolvedIntent: "SchedulingFailedRunBudget",
      confidenceLabel: "high",
      confidence: 1,
      context: { schemaVersion: 1, projectSlug, milestone, failedRuns, actionKey: input.actionKey ?? null }
    });
    decisionId = decision.id;
    pausedReason = `Failed-Run budget exceeded (${failedRuns} > ${MAX_FAILED_RUNS_PER_MILESTONE}); Decision ${decision.id} is open.`;
  }
  upsertSchedulingProject(db, projectSlug, {
    failedRuns,
    failedRunsMilestone: milestone,
    pausedReason,
    pausedDecisionId: decisionId ?? record.pausedDecisionId
  });
  recordSchedulingLog(db, {
    projectSlug,
    actionKey: input.actionKey ?? null,
    source: "arcadia",
    reason: overBudget && decisionId
      ? `Milestone paused because the failed-Run budget was exceeded (${failedRuns} failed Runs); Decision ${decisionId} opened. Last failure: ${input.reason}`
      : `Failed Run ${failedRuns} of ${MAX_FAILED_RUNS_PER_MILESTONE} recorded for the active Milestone: ${input.reason}`,
    previous: { failedRuns: failedRuns - 1 },
    next: { failedRuns, paused: Boolean(pausedReason) }
  });
  return { projectSlug, failedRuns, paused: Boolean(pausedReason), decisionId };
}

/**
 * Operator resume after the failed-Run Decision is answered.
 *
 * The pause exists to force one judgment: whether this Milestone deserves more
 * attempts. Clearing it while that Decision is still open would let the resume
 * command stand in for the answer, which is the one thing the pause is for --
 * so an unanswered Decision refuses here, and the answer (approve or reject) is
 * what makes resuming possible.
 */
export function resumeProjectScheduling(db: Database.Database, projectSlug: string, reason: string): void {
  const record = getSchedulingProject(db, projectSlug);
  if (record.pausedDecisionId) {
    const decision = getReviewItem(db, record.pausedDecisionId);
    if (decision && (decision.status === "open" || decision.status === "deferred")) {
      throw validationError("The failed-Run Decision that paused this Project is still unanswered.", {
        projectSlug,
        decisionId: decision.id,
        decisionStatus: decision.status,
        decisionNeeded: decision.decision_needed,
        remedy: `Answer it first with \`arcadia review approve ${decision.id}\` or \`arcadia review reject ${decision.id}\`, then resume; resume cannot substitute for that judgment.`
      });
    }
  }
  upsertSchedulingProject(db, projectSlug, { pausedReason: null, failedRuns: 0, pausedDecisionId: null });
  recordSchedulingLog(db, {
    projectSlug,
    actionKey: null,
    source: "decision",
    reason: `Scheduling resumed: ${reason}`,
    previous: { paused: record.pausedReason, failedRuns: record.failedRuns, decisionId: record.pausedDecisionId },
    next: { paused: null, failedRuns: 0 }
  });
}
