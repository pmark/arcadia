import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { createReviewItem, getProjectBySlug, getReviewItem, listProjects } from "../db/repositories.js";
import { transitionActionPointer } from "../dispatch/pointer.js";
import type { Project } from "../domain/types.js";
import { getRepositoryLease } from "../sessions/index.js";
import { createGitHubBoard, reconcileBoard, type ReconcileResult, type SchedulingBoard } from "./github.js";
import { buildProjectSchedule, type ProjectSchedule } from "./schedule.js";
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

export type BoardFactory = (schedule: ProjectSchedule) => SchedulingBoard | null;

export const defaultBoardFactory: BoardFactory = (schedule) => {
  if (!schedule.github || !schedule.github.repository || !schedule.repositoryRoot) return null;
  return createGitHubBoard({
    owner: schedule.github.owner,
    number: schedule.github.number,
    repository: schedule.github.repository,
    cwd: schedule.repositoryRoot
  });
};

export interface SchedulingProjectPass {
  projectSlug: string;
  next: string | null;
  currentAction: string | null;
  reconcile: ReconcileResult | null;
  reconcileError: string | null;
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
  log?: (message: string) => void;
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
  const projects: SchedulingProjectPass[] = [];
  let selection: SchedulingPassResult["selection"] = null;

  for (const project of listProjectsInSchedulingOrder(db, options.projectSlugs)) {
    let schedule = buildProjectSchedule(db, project);
    let reconcile: ReconcileResult | null = null;
    let reconcileError: string | null = null;
    if (schedule.blockers.length === 0) {
      try {
        const board = boardFactory(schedule);
        if (board) {
          reconcile = reconcileBoard(db, schedule, board, {
            requestId: `scheduler-${project.slug}-${now.getTime()}`,
            rebuild: () => buildProjectSchedule(db, project)
          });
          if (reconcile.operatorMoved || reconcile.projection?.changed) schedule = buildProjectSchedule(db, project);
        }
      } catch (error) {
        reconcileError = error instanceof Error ? error.message : String(error);
        log(`GitHub reconciliation failed for ${project.slug}: ${reconcileError}`);
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
