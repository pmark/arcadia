import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { getProjectBySlug } from "../db/repositories.js";
import { recordDiscovery, type DiscoveryKind, type DiscoveryResult } from "../scheduling/discovery.js";
import { createGitHubBoard, createGitHubProject, reconcileBoard, runGh, type ReconcileResult } from "../scheduling/github.js";
import { SCHEDULING_CLASSES, canonicalOrder, type SchedulingClass } from "../scheduling/order.js";
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
}

export function runScheduleStatusCommand(options: { workspace: string; project?: string }): CommandSuccess<ScheduleStatusData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const schedule = withReadOnlyDatabase(workspacePath, (db) => {
    const portfolio = buildPortfolioSchedule(db);
    if (!options.project) return portfolio;
    const projects = portfolio.projects.filter((entry) => entry.projectSlug === options.project);
    if (projects.length === 0) throw validationError("Unknown or inactive Project.", { project: options.project });
    return { ...portfolio, projects };
  });
  return createSuccess({ command: "schedule.status", workspace: workspacePath, data: { schedule } });
}

export function renderScheduleStatusSuccess(response: CommandSuccess<ScheduleStatusData>): string[] {
  const { schedule } = response.data;
  const lines: string[] = [
    `Production schedule (${schedule.generatedAt})`,
    `Selection: ${schedule.selection ? `${schedule.selection.actionKey}` : "none"}`,
    ""
  ];
  for (const project of schedule.projects) {
    lines.push(...renderProject(project), "");
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
    if (options.apply) {
      const pass = runSchedulingPass(db, {
        boardFactory: (schedule) => {
          if (options.project && schedule.projectSlug !== options.project) return null;
          if (!schedule.github?.repository || !schedule.repositoryRoot) return null;
          return createGitHubBoard({ owner: schedule.github.owner, number: schedule.github.number, repository: schedule.github.repository, cwd: schedule.repositoryRoot });
        }
      });
      return { pass, reconciles: pass.projects.flatMap((project) => project.reconcile ? [project.reconcile] : []), preview: false };
    }
    // Preview: read the boards and report what a pass would change, writing nothing.
    const portfolio = buildPortfolioSchedule(db);
    const reconciles: ReconcileResult[] = [];
    for (const schedule of portfolio.projects) {
      if (options.project && schedule.projectSlug !== options.project) continue;
      if (!schedule.github?.repository || !schedule.repositoryRoot) continue;
      const board = createGitHubBoard({ owner: schedule.github.owner, number: schedule.github.number, repository: schedule.github.repository, cwd: schedule.repositoryRoot });
      const keyByItem = new Map(schedule.actions.filter((action) => action.githubProjectItemId).map((action) => [action.githubProjectItemId!, action.key]));
      const observed = board.listItems().map((item) => keyByItem.get(item.itemId)).filter((key): key is string => key !== undefined && schedule.queue.includes(key));
      const lastProjected = schedule.record.lastProjectedOrder.filter((key) => schedule.queue.includes(key) && observed.includes(key));
      const operatorMoved = schedule.record.lastProjectedRevision >= 0 && observed.length > 0 && observed.join("\n") !== lastProjected.join("\n");
      reconciles.push({
        projectSlug: schedule.projectSlug,
        observedOrder: observed,
        operatorMoved,
        accepted: false,
        normalized: false,
        normalizationReasons: [],
        canonical: schedule.queue,
        revision: schedule.queueRevision,
        projection: null
      });
    }
    return { pass: null, reconciles, preview: true };
  });
  return createSuccess({ command: "schedule.reconcile", workspace: workspacePath, data });
}

export function renderScheduleReconcileSuccess(response: CommandSuccess<ScheduleReconcileData>): string[] {
  const { pass, reconciles, preview } = response.data;
  const lines: string[] = [preview ? "Reconciliation preview (nothing written):" : "Reconciliation applied:"];
  if (reconciles.length === 0) lines.push("  No Project is linked to a GitHub board.");
  for (const entry of reconciles) {
    lines.push(`  ${entry.projectSlug}: board ${entry.observedOrder.join(" → ") || "empty"}`);
    lines.push(`    operator moved: ${entry.operatorMoved ? "yes" : "no"}${entry.accepted ? " (accepted)" : ""}${entry.normalized ? ` (normalized: ${entry.normalizationReasons.join(" ")})` : ""}`);
    lines.push(`    canonical: ${entry.canonical.join(" → ") || "empty"} (revision ${entry.revision})`);
    if (entry.projection) {
      lines.push(`    projected: ${entry.projection.issuesCreated.length} issue(s), ${entry.projection.itemsAdded.length} item(s), ${entry.projection.statusChanges.length} status change(s), ${entry.projection.moves.length} move(s)`);
    }
  }
  if (pass) {
    for (const project of pass.projects) {
      if (project.pointer.moved) lines.push(`  ${project.projectSlug}: pointer ${project.pointer.from ?? "none"} → ${project.pointer.to}`);
      if (project.reconcileError) lines.push(`  ${project.projectSlug}: GitHub error: ${project.reconcileError}`);
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
    let id: string | null = null;
    let url: string | null = null;
    let created = false;
    if (number === null) {
      if (!options.create) throw validationError("Provide --number for an existing GitHub Project or --create to make one.");
      const made = createGitHubProject({ owner: options.owner, title: options.title ?? `${project.name} — Development`, cwd: schedule.repositoryRoot });
      number = made.number;
      id = made.id;
      url = made.url;
      created = true;
    }
    // Resolving the board verifies the Project exists and creates the status field when missing.
    createGitHubBoard({ owner: options.owner, number, repository, cwd: schedule.repositoryRoot });
    upsertSchedulingProject(db, project.slug, { githubOwner: options.owner, githubProjectNumber: number, githubProjectId: id, githubRepository: repository, lastProjectedRevision: -1, lastProjectedOrder: [] });
    recordSchedulingLog(db, { projectSlug: project.slug, actionKey: null, source: "arcadia", reason: `${created ? "Created and linked" : "Linked"} GitHub Project ${options.owner}/${number} (issues in ${repository}).`, next: { owner: options.owner, number, repository } });
    return { projectSlug: project.slug, owner: options.owner, number, repository, created, url };
  });
  return createSuccess({ command: "schedule.github.link", workspace: workspacePath, data });
}

export function renderScheduleGitHubLinkSuccess(response: CommandSuccess<ScheduleGitHubLinkData>): string[] {
  const { projectSlug, owner, number, repository, created, url } = response.data;
  return [
    `${created ? "Created and linked" : "Linked"} ${projectSlug} → GitHub Project ${owner}/${number}${url ? ` (${url})` : ""}; issues in ${repository}.`,
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
