import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { getProjectBySlug } from "../db/repositories.js";
import { resolveBatch, type BatchResolution } from "../docs/batch.js";
import { recordDiscovery, type DiscoveryKind, type DiscoveryResult } from "../scheduling/discovery.js";
import {
  BOARD_PUSHES,
  BOARD_PUSH_FIELD,
  BOARD_STATUSES,
  BOARD_STATUS_FIELD,
  createGitHubBoard,
  createGitHubProject,
  ensureBoardFields,
  reconcileBoard,
  runGh,
  type ReconcileResult
} from "../scheduling/github.js";
import { SCHEDULING_CLASSES, applyOperatorOrder, canonicalOrder, sameSequence, type SchedulingClass } from "../scheduling/order.js";
import { buildPortfolioSchedule, buildProjectSchedule, orderCandidates, writeProjectOrder, type PortfolioSchedule, type ProjectSchedule } from "../scheduling/schedule.js";
import { resumeProjectScheduling, runSchedulingPass, type SchedulingPassResult } from "../scheduling/scheduler.js";
import {
  getSchedulingAction,
  listSchedulingLog,
  recordSchedulingLog,
  upsertSchedulingAction,
  upsertSchedulingProject,
  type SchedulingLogEntry
} from "../scheduling/store.js";

/**
 * `arcadia schedule ...` -- the operator surface for production scheduling.
 * Nouns (`status`, `log`) read; verbs (`prioritize`, `classify`, `discover`,
 * `reconcile`, `resume`, `github link|create`) mutate within the authority
 * the operator holds by running them.
 */

export interface ScheduleStatusData {
  schedule: PortfolioSchedule;
  /** The current push: the ready-set prefix, laned by repository, to the next
   *  operator gate. Recomputed on every read from the same documents — never
   *  stored, because a stale batch label is worse than none. */
  batch: BatchResolution;
}

export function runScheduleStatusCommand(options: { workspace: string; project?: string }): CommandSuccess<ScheduleStatusData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db): ScheduleStatusData => {
    const portfolio = buildPortfolioSchedule(db);
    const scoped = options.project
      ? portfolio.projects.filter((entry) => entry.projectSlug === options.project)
      : portfolio.projects;
    if (options.project && scoped.length === 0) throw validationError("Unknown or inactive Project.", { project: options.project });
    return {
      schedule: options.project ? { ...portfolio, projects: scoped } : portfolio,
      batch: resolveBatch(
        scoped
          .filter((entry) => entry.repositoryRoot !== null)
          .map((entry) => ({ repositoryRoot: entry.repositoryRoot!, projectSlug: entry.projectSlug }))
      )
    };
  });
  return createSuccess({ command: "schedule.status", workspace: workspacePath, data });
}

export function renderScheduleStatusSuccess(response: CommandSuccess<ScheduleStatusData>): string[] {
  const { schedule, batch } = response.data;
  const lines: string[] = [
    `Production schedule (${schedule.generatedAt})`,
    `Selection: ${schedule.selection ? `${schedule.selection.actionKey}` : "none"}`,
    ...renderPush(batch),
    ""
  ];
  for (const project of schedule.projects) {
    lines.push(...renderProject(project), "");
  }
  return lines;
}

function renderPush(batch: BatchResolution): string[] {
  if (batch.lanes.length === 0) return ["This push: nothing ready."];
  const lines = [`This push (${batch.token.points} token points):`];
  for (const lane of batch.lanes) {
    lines.push(`  Lane ${lane.laneLabel}${lane.sequenceAdvised ? " (sequence advised)" : ""}:`);
    for (const action of lane.actions) {
      lines.push(`    ${action.position}. ${action.actionId} — ${action.title}`);
    }
    for (const stop of lane.stops) {
      const label = stop === lane.boundary ? "Boundary" : "Waiting";
      lines.push(`    ${label} [${stop.kind}] ${stop.actionId}: ${stop.prompt}`);
    }
    if (lane.nextPush.length > 0) {
      lines.push(`    Next push (${lane.nextPush.length}): ${lane.nextPush.map((action) => action.actionId).join(", ")}`);
    }
  }
  return lines;
}

function renderProject(project: ProjectSchedule): string[] {
  const byKey = new Map(project.actions.map((action) => [action.key, action]));
  const lines = [
    `${project.projectName} (${project.projectSlug}) · priority ${project.priority} · milestone: ${project.milestone ?? "none"} · plan: ${project.planSlug ?? "none"}`,
    `  Queue revision ${project.queueRevision} · projected ${project.lastProjectedRevision < 0 ? "never" : project.lastProjectedRevision} · GitHub: ${project.github ? `${project.github.owner}/${project.github.number}${project.github.repository ? ` (${project.github.repository})` : ""}` : "not linked"}`,
    `  Pointer: ${project.currentAction ?? "none"} · Next: ${project.next ?? "none"}${project.pausedReason ? ` · PAUSED: ${project.pausedReason}` : ""}`
  ];
  for (const blocker of project.blockers) lines.push(`  Blocker: ${blocker.message} → ${blocker.remedy}`);
  if (project.queue.length > 0) {
    lines.push("  Queue:");
    project.queue.forEach((key, index) => {
      const action = byKey.get(key)!;
      lines.push(`    ${index + 1}. ${action.actionId} [${action.schedulingClass}] ${action.status}${action.current ? " ← pointer" : ""}${action.githubIssueNumber ? ` #${action.githubIssueNumber}` : ""} — ${action.reason}`);
    });
  }
  if (project.backlog.length > 0) lines.push(`  Backlog: ${project.backlog.map((key) => byKey.get(key)!.actionId).join(", ")}`);
  return lines;
}

export interface ScheduleLogData {
  entries: SchedulingLogEntry[];
}

export function runScheduleLogCommand(options: { workspace: string; project?: string; limit?: number }): CommandSuccess<ScheduleLogData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const entries = withReadOnlyDatabase(workspacePath, (db) => listSchedulingLog(db, { projectSlug: options.project, limit: options.limit }));
  return createSuccess({ command: "schedule.log", workspace: workspacePath, data: { entries } });
}

export function renderScheduleLogSuccess(response: CommandSuccess<ScheduleLogData>): string[] {
  if (response.data.entries.length === 0) return ["No scheduling mutations recorded."];
  return response.data.entries.map((entry) =>
    `${entry.at} [${entry.source}] ${entry.projectSlug ?? "-"}${entry.actionKey ? ` ${entry.actionKey}` : ""}: ${entry.reason}`
  );
}

export interface SchedulePrioritizeData {
  order: Array<{ projectSlug: string; priority: number }>;
}

export function runSchedulePrioritizeCommand(options: { workspace: string; order: string[] }): CommandSuccess<SchedulePrioritizeData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const slugs = options.order.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  if (slugs.length === 0) throw validationError("Provide the Project slugs in priority order.");
  const order = withDatabase(workspacePath, (db) => {
    for (const slug of slugs) {
      if (!getProjectBySlug(db, slug)) throw validationError("Unknown Project slug.", { project: slug });
    }
    const result = slugs.map((slug, index) => {
      upsertSchedulingProject(db, slug, { priority: index + 1 });
      return { projectSlug: slug, priority: index + 1 };
    });
    recordSchedulingLog(db, { projectSlug: null, actionKey: null, source: "arcadia", reason: `Cross-Project order set: ${slugs.join(" > ")}.`, next: { order: slugs } });
    return result;
  });
  return createSuccess({ command: "schedule.prioritize", workspace: workspacePath, data: { order } });
}

export function renderSchedulePrioritizeSuccess(response: CommandSuccess<SchedulePrioritizeData>): string[] {
  return ["Cross-Project scheduling order:", ...response.data.order.map((entry) => `  ${entry.priority}. ${entry.projectSlug}`)];
}

export interface ScheduleClassifyData {
  actionKey: string;
  from: SchedulingClass;
  to: SchedulingClass;
  queue: string[];
}

export function runScheduleClassifyCommand(options: { workspace: string; action: string; class: string; requestId: string }): CommandSuccess<ScheduleClassifyData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!SCHEDULING_CLASSES.includes(options.class as SchedulingClass)) {
    throw validationError("Unknown scheduling class.", { class: options.class, allowed: SCHEDULING_CLASSES });
  }
  const to = options.class as SchedulingClass;
  const data = withDatabase(workspacePath, (db) => {
    const slash = options.action.indexOf("/");
    const projectSlug = slash > 0 ? options.action.slice(0, slash) : "";
    const project = getProjectBySlug(db, projectSlug);
    if (!project) throw validationError("Action key must be <project>/<action> for a known Project.", { action: options.action });
    const schedule = buildProjectSchedule(db, project);
    const action = schedule.actions.find((entry) => entry.key === options.action);
    if (!action) throw validationError("Action is not in the Project's active Plan.", { action: options.action });
    const from = getSchedulingAction(db, options.action)?.schedulingClass ?? "planned";
    upsertSchedulingAction(db, options.action, { schedulingClass: to });
    const refreshed = buildProjectSchedule(db, project);
    const write = writeProjectOrder(db, project.slug, canonicalOrder(orderCandidates(refreshed.actions)), {
      requestId: `${options.requestId}:order`,
      source: "arcadia",
      actionKey: options.action,
      reason: `Scheduling class of ${options.action} changed ${from} → ${to}; queue recomputed.`
    });
    if (!write.changed) {
      recordSchedulingLog(db, { projectSlug: project.slug, actionKey: options.action, source: "arcadia", reason: `Scheduling class of ${options.action} changed ${from} → ${to}; order unchanged.`, previous: { class: from }, next: { class: to }, requestId: options.requestId });
    }
    return { actionKey: options.action, from, to, queue: buildProjectSchedule(db, project).queue };
  });
  return createSuccess({ command: "schedule.classify", workspace: workspacePath, data });
}

export function renderScheduleClassifySuccess(response: CommandSuccess<ScheduleClassifyData>): string[] {
  const { actionKey, from, to, queue } = response.data;
  return [`${actionKey}: ${from} → ${to}`, `Queue: ${queue.join(" → ") || "empty"}`];
}

export interface ScheduleDiscoverData {
  result: DiscoveryResult;
}

export function runScheduleDiscoverCommand(options: {
  workspace: string;
  from: string;
  kind: string;
  title: string;
  acceptance: string[];
  evidence?: string;
  requestId: string;
}): CommandSuccess<ScheduleDiscoverData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!["blocker", "corrective", "follow_up"].includes(options.kind)) {
    throw validationError("Discovery kind must be blocker, corrective, or follow_up.", { kind: options.kind });
  }
  const result = withDatabase(workspacePath, (db) => recordDiscovery(db, {
    originActionKey: options.from,
    kind: options.kind as DiscoveryKind,
    title: options.title,
    acceptance: options.acceptance,
    evidence: options.evidence,
    requestId: options.requestId
  }));
  return createSuccess({ command: "schedule.discover", workspace: workspacePath, data: { result } });
}

export function renderScheduleDiscoverSuccess(response: CommandSuccess<ScheduleDiscoverData>): string[] {
  const { result } = response.data;
  const lines = [
    `${result.outcome}: ${result.reason}`,
    result.actionKey ? `Action: ${result.actionKey} (${result.planPath})` : `Decision: ${result.decisionId}`,
    `Queue: ${result.queueBefore.join(" → ") || "empty"}`,
    `   now: ${result.queueAfter.join(" → ") || "empty"}`
  ];
  if (result.commitError) lines.push(`Warning: the Plan was written but not committed: ${result.commitError}`);
  return lines;
}

export interface ScheduleReconcileData {
  pass: SchedulingPassResult | null;
  reconciles: ReconcileResult[];
  preview: boolean;
}

export function runScheduleReconcileCommand(options: { workspace: string; project?: string; apply?: boolean }): CommandSuccess<ScheduleReconcileData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db): ScheduleReconcileData => {
    if (options.project && !getProjectBySlug(db, options.project)) {
      throw validationError("Unknown Project slug.", { project: options.project });
    }
    // `--project` scopes the whole pass, not just which board is read: a pass
    // scoped to one Project must not commit another Project's pointer move.
    const projectSlugs = options.project ? [options.project] : undefined;
    if (options.apply) {
      // An operator asking for a reconcile gets one now. The poll throttle
      // exists to keep the two-second worker tick off GitHub's rate limit, not
      // to ignore an explicit command.
      const pass = runSchedulingPass(db, { projectSlugs, boardPollIntervalMs: 0 });
      return { pass, reconciles: pass.projects.flatMap((project) => project.reconcile ? [project.reconcile] : []), preview: false };
    }

    // Preview reads every linked board in scope and reports what an applied
    // pass would change. It writes nothing -- not to Arcadia, and not to
    // GitHub: `createGitHubBoard` only reads, and creating a missing status
    // field belongs to `schedule github link`.
    const reconciles: ReconcileResult[] = [];
    for (const schedule of buildPortfolioSchedule(db).projects) {
      if (projectSlugs && !projectSlugs.includes(schedule.projectSlug)) continue;
      if (!schedule.github?.repository || !schedule.repositoryRoot) continue;
      const cached = schedule.record.githubProjectId && schedule.record.githubStatusFieldId && schedule.record.githubStatusOptions
        && schedule.record.githubPushField !== null
        ? {
            projectId: schedule.record.githubProjectId,
            statusFieldId: schedule.record.githubStatusFieldId,
            statusOptions: schedule.record.githubStatusOptions,
            pushField: "absent" in schedule.record.githubPushField ? null : schedule.record.githubPushField
          }
        : null;
      const board = createGitHubBoard(
        { owner: schedule.github.owner, number: schedule.github.number, repository: schedule.github.repository, cwd: schedule.repositoryRoot },
        runGh,
        cached
      );
      const keyByItem = new Map(schedule.actions.filter((action) => action.githubProjectItemId).map((action) => [action.githubProjectItemId!, action.key]));
      const observed = board.listItems().map((item) => keyByItem.get(item.itemId)).filter((key): key is string => key !== undefined && schedule.queue.includes(key));
      const lastProjected = schedule.record.lastProjectedOrder.filter((key) => schedule.queue.includes(key) && observed.includes(key));
      // A board mid-projection differs from the last projected order because
      // the previous pass did not finish, not because anyone dragged a card.
      const resumedProjection = schedule.record.projectionInFlight;
      const operatorMoved = !resumedProjection
        && schedule.record.lastProjectedRevision >= 0
        && observed.length > 0
        && !sameSequence(observed, lastProjected);
      const applied = operatorMoved ? applyOperatorOrder(orderCandidates(schedule.actions), observed) : null;
      reconciles.push({
        projectSlug: schedule.projectSlug,
        observedOrder: observed,
        operatorMoved,
        accepted: false,
        normalized: applied?.normalized ?? false,
        normalizationReasons: applied?.normalizationReasons ?? [],
        canonical: applied?.canonical ?? schedule.queue,
        revision: schedule.queueRevision,
        projection: null,
        resumedProjection
      });
    }
    return { pass: null, reconciles, preview: true };
  });
  return createSuccess({ command: "schedule.reconcile", workspace: workspacePath, data });
}

export function renderScheduleReconcileSuccess(response: CommandSuccess<ScheduleReconcileData>): string[] {
  const { pass, reconciles, preview } = response.data;
  const lines: string[] = [preview ? "Reconciliation preview (nothing written):" : "Reconciliation applied:"];
  // `reconciles` is empty both when nothing has a board linked and when a
  // linked board's reconcile attempt threw -- those are different states, so
  // only report "no board linked" when nothing in this pass actually reached
  // GitHub (no reconcile, no error, no board-skip reason recorded).
  const anyBoardAttempted = pass
    ? pass.projects.some((project) => project.reconcile !== null || project.reconcileError !== null || project.boardSkipped !== null)
    : reconciles.length > 0;
  if (!anyBoardAttempted) lines.push("  No Project is linked to a GitHub board.");
  for (const entry of reconciles) {
    lines.push(`  ${entry.projectSlug}: board ${entry.observedOrder.join(" → ") || "empty"}`);
    lines.push(`    operator moved: ${entry.operatorMoved ? "yes" : "no"}${entry.accepted ? " (accepted)" : ""}${entry.normalized ? ` (normalized: ${entry.normalizationReasons.join(" ")})` : ""}`);
    if (entry.resumedProjection) lines.push("    an earlier projection did not finish; this board is being re-projected, not read as an operator drag");
    lines.push(`    canonical: ${entry.canonical.join(" → ") || "empty"} (revision ${entry.revision})`);
    if (entry.projection) {
      lines.push(`    projected: ${entry.projection.issuesCreated.length} issue(s), ${entry.projection.itemsAdded.length} item(s), ${entry.projection.statusChanges.length} status change(s), ${entry.projection.moves.length} move(s)`);
    }
  }
  if (pass) {
    for (const project of pass.projects) {
      if (project.pointer.moved) lines.push(`  ${project.projectSlug}: pointer ${project.pointer.from ?? "none"} → ${project.pointer.to}`);
      if (project.reconcileError) lines.push(`  ${project.projectSlug}: GitHub error: ${project.reconcileError}`);
      if (project.boardSkipped) lines.push(`  ${project.projectSlug}: board not read — ${project.boardSkipped}`);
    }
    lines.push(`Selection: ${pass.selection?.actionKey ?? "none"}`);
  }
  return lines;
}

export interface ScheduleGitHubLinkData {
  projectSlug: string;
  owner: string;
  number: number;
  repository: string;
  created: boolean;
  url: string | null;
  /** Whether this link created the board's `Arcadia status` field. */
  statusFieldCreated: boolean;
  /** Whether this link created the board's `Arcadia push` field. */
  pushFieldCreated: boolean;
}

export function runScheduleGitHubLinkCommand(options: {
  workspace: string;
  project: string;
  owner: string;
  number?: number;
  repository?: string;
  create?: boolean;
  title?: string;
}): CommandSuccess<ScheduleGitHubLinkData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withDatabase(workspacePath, (db): ScheduleGitHubLinkData => {
    const project = getProjectBySlug(db, options.project);
    if (!project) throw validationError("Unknown Project slug.", { project: options.project });
    const schedule = buildProjectSchedule(db, project);
    if (!schedule.repositoryRoot) throw validationError("Project has no repository path; link needs one for gh to run in.", { blockers: schedule.blockers });
    const repository = options.repository ?? detectRepository(schedule.repositoryRoot);
    let number = options.number ?? null;
    let url: string | null = null;
    let created = false;
    if (number === null) {
      if (!options.create) throw validationError("Provide --number for an existing GitHub Project or --create to make one.");
      const made = createGitHubProject({ owner: options.owner, title: options.title ?? `${project.name} — Development`, cwd: schedule.repositoryRoot });
      number = made.number;
      url = made.url;
      created = true;
    }
    // Link is the one command that may change the board's schema: it creates
    // whichever of the `Arcadia status` and `Arcadia push` fields is missing,
    // then opens the board read-only to prove the result is usable.
    const field = ensureBoardFields({ owner: options.owner, number, repository, cwd: schedule.repositoryRoot });
    // Persist the identity this open resolved, including the push field it now
    // finds. Without this, a cached `{ absent: true }` from before the field
    // existed would survive the link and no pass would ever project a label.
    const board = createGitHubBoard({ owner: options.owner, number, repository, cwd: schedule.repositoryRoot });
    upsertSchedulingProject(db, project.slug, {
      githubOwner: options.owner,
      githubProjectNumber: number,
      githubProjectId: board.identity.projectId,
      githubRepository: repository,
      githubStatusFieldId: board.identity.statusFieldId,
      githubStatusOptions: board.identity.statusOptions,
      githubPushField: board.identity.pushField ?? { absent: true },
      lastProjectedRevision: -1,
      lastProjectedOrder: []
    });
    recordSchedulingLog(db, { projectSlug: project.slug, actionKey: null, source: "arcadia", reason: `${created ? "Created and linked" : "Linked"} GitHub Project ${options.owner}/${number} (issues in ${repository})${field.statusCreated ? `; created the "${BOARD_STATUS_FIELD}" field` : ""}${field.pushCreated ? `; created the "${BOARD_PUSH_FIELD}" field` : ""}.`, next: { owner: options.owner, number, repository, statusFieldCreated: field.statusCreated, pushFieldCreated: field.pushCreated } });
    return { projectSlug: project.slug, owner: options.owner, number, repository, created, url, statusFieldCreated: field.statusCreated, pushFieldCreated: field.pushCreated };
  });
  return createSuccess({ command: "schedule.github.link", workspace: workspacePath, data });
}

export function renderScheduleGitHubLinkSuccess(response: CommandSuccess<ScheduleGitHubLinkData>): string[] {
  const { projectSlug, owner, number, repository, created, url, statusFieldCreated, pushFieldCreated } = response.data;
  return [
    `${created ? "Created and linked" : "Linked"} ${projectSlug} → GitHub Project ${owner}/${number}${url ? ` (${url})` : ""}; issues in ${repository}.`,
    statusFieldCreated ? `Created the "${BOARD_STATUS_FIELD}" single-select field with options: ${BOARD_STATUSES.join(", ")}.` : `The "${BOARD_STATUS_FIELD}" field already existed; nothing on the board was changed.`,
    pushFieldCreated ? `Created the "${BOARD_PUSH_FIELD}" single-select field with options: ${BOARD_PUSHES.join(", ")}. Group the board by it to see the push, and filter "Arcadia push:Next push" out of the execution view.` : `The "${BOARD_PUSH_FIELD}" field already existed.`,
    "Run `arcadia schedule reconcile --apply` to project the queue onto the board."
  ];
}

function detectRepository(cwd: string): string {
  const result = runGh(cwd, "gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const repository = result.ok ? result.stdout.trim() : "";
  if (!repository) throw validationError("Could not identify the GitHub repository; pass --repository owner/name.", { stderr: result.stderr.trim() });
  return repository;
}

export interface ScheduleResumeData {
  projectSlug: string;
}

export function runScheduleResumeCommand(options: { workspace: string; project: string; reason: string }): CommandSuccess<ScheduleResumeData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  withDatabase(workspacePath, (db) => {
    if (!getProjectBySlug(db, options.project)) throw validationError("Unknown Project slug.", { project: options.project });
    resumeProjectScheduling(db, options.project, options.reason);
  });
  return createSuccess({ command: "schedule.resume", workspace: workspacePath, data: { projectSlug: options.project } });
}

export function renderScheduleResumeSuccess(response: CommandSuccess<ScheduleResumeData>): string[] {
  return [`Scheduling resumed for ${response.data.projectSlug}; the failed-Run counter is reset.`];
}

export type { ReconcileResult };
export { reconcileBoard };
