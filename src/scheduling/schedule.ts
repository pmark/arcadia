import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { resolveActionReadiness, type DispatchBlocker } from "../docs/dispatch.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanActionDoc, PlanDoc, ProjectDoc } from "../docs/types.js";
import type { Project } from "../domain/types.js";
import { arrangeActionOrder, loadActionOrder, type ActionOrderReceipt } from "../dispatch/order.js";
import { listActiveAgentSessions } from "../sessions/index.js";
import { canonicalOrder, type OrderCandidate, type SchedulingClass } from "./order.js";
import {
  actionKeyOf,
  getSchedulingProject,
  listSchedulingActions,
  recordSchedulingLog,
  type SchedulingLogSource,
  type SchedulingProjectRecord
} from "./store.js";

/**
 * One Project's production schedule: the active Plan's Actions with the
 * scheduling status, tier and position of each, the canonical queue order,
 * and the next runnable Action. Read-only composition -- the checked-in
 * documents remain the truth about what the Actions are, the queue tables
 * about where they sit, and this joins the two.
 */

export type ScheduleStatus = "ready" | "running" | "blocked" | "needs_operator" | "done" | "deferred";

export interface ScheduledAction {
  key: string;
  projectSlug: string;
  actionId: string;
  title: string;
  schedulingClass: SchedulingClass;
  status: ScheduleStatus;
  /** Why the Action holds its status, in one sentence. */
  reason: string;
  position: number | null;
  dependsOn: string[];
  current: boolean;
  discoveredByActionKey: string | null;
  discoveryDepth: number;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubProjectItemId: string | null;
  /** Plan declaration order. */
  index: number;
}

export interface ProjectSchedule {
  projectId: string;
  projectSlug: string;
  projectName: string;
  repositoryRoot: string | null;
  planSlug: string | null;
  planPath: string | null;
  milestone: string | null;
  currentAction: string | null;
  priority: number;
  queueRevision: number;
  lastProjectedRevision: number;
  pausedReason: string | null;
  github: { owner: string; number: number; id: string | null; repository: string | null } | null;
  /** Every Action in the active Plan, declaration order. */
  actions: ScheduledAction[];
  /** Canonical queue: unfinished queued Actions in effective order. */
  queue: string[];
  /** Follow-ups and other unqueued work. */
  backlog: string[];
  /** The Action the scheduler would start now, or null. */
  next: string | null;
  /** Why the Project cannot be scheduled at all, when it cannot. */
  blockers: DispatchBlocker[];
  record: SchedulingProjectRecord;
}

export interface PortfolioSchedule {
  generatedAt: string;
  /** Projects in cross-Project priority order. */
  projects: ProjectSchedule[];
  /** The first Project with runnable work and the Action it would run. */
  selection: { projectSlug: string; actionKey: string } | null;
}

/**
 * A Project's repository as the scheduler sees it: resolved to a real path, or
 * null when the configured path is missing or unusable.
 *
 * Exported so any caller that needs to know which Projects share a repository
 * resolves it exactly the way `buildProjectSchedule` does — two spellings of
 * the same checkout would put two Projects in two different push lanes.
 */
export function projectRepositoryRoot(db: Database.Database, project: Project): string | null {
  const configuredPath = getProjectMetadata(db, project.id)?.repo_path?.trim() ?? null;
  if (!configuredPath || !existsSync(configuredPath) || !statSync(configuredPath).isDirectory()) return null;
  return realpathSync(path.resolve(configuredPath));
}

export function buildPortfolioSchedule(db: Database.Database, options: { now?: Date } = {}): PortfolioSchedule {
  const active = listProjects(db).filter((project) => project.status === "active");
  const projects = active
    .map((project) => buildProjectSchedule(db, project))
    .sort((left, right) => left.priority - right.priority || left.projectSlug.localeCompare(right.projectSlug));
  const first = projects.find((schedule) => schedule.next !== null) ?? null;
  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    projects,
    selection: first ? { projectSlug: first.projectSlug, actionKey: first.next! } : null
  };
}

export function buildProjectSchedule(db: Database.Database, project: Project): ProjectSchedule {
  const record = getSchedulingProject(db, project.slug);
  const order = loadActionOrder(db);
  const base: ProjectSchedule = {
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    repositoryRoot: null,
    planSlug: null,
    planPath: null,
    milestone: null,
    currentAction: null,
    priority: record.priority,
    queueRevision: order.revision,
    lastProjectedRevision: record.lastProjectedRevision,
    pausedReason: record.pausedReason,
    github: record.githubOwner && record.githubProjectNumber !== null
      ? { owner: record.githubOwner, number: record.githubProjectNumber, id: record.githubProjectId, repository: record.githubRepository }
      : null,
    actions: [],
    queue: [],
    backlog: [],
    next: null,
    blockers: [],
    record
  };

  const repositoryRoot = projectRepositoryRoot(db, project);
  if (!repositoryRoot) {
    base.blockers.push({
      relativePath: "project_metadata",
      field: "repo_path",
      message: "Project has no usable repository path configured.",
      remedy: "Set the Project repository path before scheduling its Actions."
    });
    return base;
  }
  base.repositoryRoot = repositoryRoot;

  const discovered = discoverDocs(repositoryRoot);
  const projectDoc = discovered.docs.find((doc): doc is ProjectDoc => doc.type === "project" && doc.slug === project.slug) ?? null;
  if (!projectDoc) {
    base.blockers.push({ relativePath: "PROJECT.md", field: "slug", message: `No PROJECT.md for ${project.slug} was found in the repository.`, remedy: "Add the managed Project document before scheduling." });
    return base;
  }
  base.currentAction = projectDoc.currentAction;
  if (!projectDoc.activePlan) {
    base.blockers.push({ relativePath: projectDoc.relativePath, field: "active_plan", message: "The Project has no active Plan, so there is no active Milestone queue.", remedy: "Point active_plan at the Plan that carries the active Milestone." });
    return base;
  }
  const plan = discovered.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug && doc.slug === projectDoc.activePlan) ?? null;
  if (!plan) {
    base.blockers.push({ relativePath: projectDoc.relativePath, field: "active_plan", message: `Active Plan ${projectDoc.activePlan} was not found.`, remedy: "Repair active_plan or add the Plan document." });
    return base;
  }
  base.planSlug = plan.slug;
  base.planPath = plan.relativePath;
  base.milestone = plan.milestone ?? projectDoc.milestone;
  base.currentAction = projectDoc.currentAction ?? plan.currentAction;

  const schedulingRows = new Map(listSchedulingActions(db, project.slug).map((row) => [row.actionKey, row]));
  const runningActionIds = new Set(
    listActiveAgentSessions(db).filter((session) => session.project_slug === project.slug).map((session) => session.action_id)
  );

  base.actions = plan.actions.map((action, index) => {
    const key = actionKeyOf(project.slug, action.id);
    const row = schedulingRows.get(key) ?? null;
    const schedulingClass = row?.schedulingClass ?? "planned";
    const { status, reason } = deriveStatus(repositoryRoot, project.slug, action, schedulingClass, runningActionIds, record.pausedReason);
    return {
      key,
      projectSlug: project.slug,
      actionId: action.id,
      title: action.title,
      schedulingClass,
      status,
      reason,
      position: order.positions.get(key) ?? null,
      dependsOn: action.dependsOn.map((dependency) => actionKeyOf(project.slug, dependency)),
      current: base.currentAction === action.id,
      discoveredByActionKey: row?.discoveredByActionKey ?? null,
      discoveryDepth: row?.discoveryDepth ?? 0,
      githubIssueNumber: row?.githubIssueNumber ?? null,
      githubIssueUrl: row?.githubIssueUrl ?? null,
      githubProjectItemId: row?.githubProjectItemId ?? null,
      index
    };
  });

  // Deferred Actions leave the queue entirely. Anything depending on one stays
  // blocked through `resolveActionReadiness`, which treats an unfinished
  // dependency as unmet whether it is deferred or merely not started.
  base.queue = canonicalOrder(orderCandidates(base.actions.filter((action) => action.status !== "deferred")));
  base.backlog = base.actions.filter((action) => action.status === "deferred").map((action) => action.key);
  const byKey = new Map(base.actions.map((action) => [action.key, action]));
  base.next = record.pausedReason
    ? null
    : base.queue.find((key) => byKey.get(key)?.status === "ready") ?? null;
  return base;
}

function deriveStatus(
  repositoryRoot: string,
  projectSlug: string,
  action: PlanActionDoc,
  schedulingClass: SchedulingClass,
  runningActionIds: Set<string>,
  pausedReason: string | null
): { status: ScheduleStatus; reason: string } {
  if (action.status === "done") return { status: "done", reason: "The Plan records this Action as done." };
  // An answered Decision parked this Action against a reviving condition. It is
  // settled, not pending, so it belongs in the backlog rather than in the column
  // that means "Arcadia needs an answer from you".
  if (action.status === "deferred") {
    return { status: "deferred", reason: "An answered Decision deferred this Action; it revives on its named condition." };
  }
  if (schedulingClass === "follow_up") return { status: "deferred", reason: "Follow-up work waits in the backlog and never enters the active queue." };
  if (runningActionIds.has(action.id)) return { status: "running", reason: "A live Session holds this Action." };
  if (action.responsibility === "requires_review") return { status: "needs_operator", reason: "The Action requires operator review." };
  if (action.responsibility === "blocked" || action.status === "blocked") return { status: "blocked", reason: "The Action is externally blocked." };
  if (action.clarification === "question_open") return { status: "needs_operator", reason: action.question ?? "The Action has an open clarification question." };
  const readiness = resolveActionReadiness(repositoryRoot, projectSlug, action.id);
  if (readiness.operatorQuestion) return { status: "needs_operator", reason: readiness.operatorQuestion };
  // An approved `defer` Decision parks its Action at read time, before the
  // consequence is written into the Plan, so it arrives only as a readiness
  // blocker against the Action's own status field.
  const deferral = readiness.blockers.find((blocker) => blocker.field.endsWith(".status") && blocker.message.includes("is deferred"));
  if (deferral) return { status: "deferred", reason: deferral.message };
  const dependencyBlocker = readiness.blockers.find((blocker) => blocker.field.includes("depends_on") || /depends on/i.test(blocker.message));
  if (dependencyBlocker) return { status: "blocked", reason: dependencyBlocker.message };
  if (readiness.blockers.length > 0) return { status: "needs_operator", reason: readiness.blockers[0].message };
  if (pausedReason) return { status: "needs_operator", reason: pausedReason };
  return { status: "ready", reason: "Every dependency is met and the Action is eligible to run." };
}

export function orderCandidates(actions: ScheduledAction[]): OrderCandidate[] {
  return actions.map((action) => ({
    key: action.key,
    schedulingClass: action.schedulingClass,
    position: action.position,
    dependsOn: action.dependsOn,
    done: action.status === "done",
    index: action.index
  }));
}

export interface ProjectOrderWrite {
  changed: boolean;
  receipt: ActionOrderReceipt | null;
  before: string[];
  after: string[];
  revision: number;
}

/**
 * Persist one Project's queue order into the shared portfolio queue without
 * disturbing any other Project's relative positions: the Project's existing
 * slots are refilled in the new order and any newly queued Action is appended.
 * Every write bumps the queue revision through the existing receipt path, so
 * `advance queue undo` and revision checks keep working unchanged.
 */
export function writeProjectOrder(
  db: Database.Database,
  projectSlug: string,
  orderedKeys: string[],
  input: { requestId: string; source: SchedulingLogSource; reason: string; actionKey?: string | null }
): ProjectOrderWrite {
  const state = loadActionOrder(db);
  const positioned = [...state.positions.entries()].sort((left, right) => left[1] - right[1]).map(([key]) => key);
  const prefix = `${projectSlug}/`;
  const before = positioned.filter((key) => key.startsWith(prefix));
  if (sameOrder(before, orderedKeys)) {
    return { changed: false, receipt: null, before, after: orderedKeys, revision: state.revision };
  }

  // Refill this Project's own slots in the new order. Inserting at each
  // original slot index in ascending order reproduces the other Projects'
  // positions exactly, because everything before a slot is already in place.
  const slots: number[] = [];
  positioned.forEach((key, index) => {
    if (key.startsWith(prefix)) slots.push(index);
  });
  const others = positioned.filter((key) => !key.startsWith(prefix));
  const full: string[] = [...others];
  const remainingProjectKeys = [...orderedKeys];
  for (const slot of slots) {
    const next = remainingProjectKeys.shift();
    if (next === undefined) break;
    full.splice(Math.min(slot, full.length), 0, next);
  }
  full.push(...remainingProjectKeys);

  // Stale positioned keys of this Project (done or dropped Actions) leave the
  // queue here: the membership arrange validates against is exactly `full`.
  const receipt = arrangeActionOrder(db, {
    currentKeys: [...others, ...orderedKeys],
    order: full,
    requestId: input.requestId,
    apply: true
  });
  recordSchedulingLog(db, {
    projectSlug,
    actionKey: input.actionKey ?? null,
    source: input.source,
    reason: input.reason,
    previous: { order: before, revision: receipt.revisionBefore },
    next: { order: orderedKeys, revision: receipt.revisionAfter }
  });
  return { changed: true, receipt, before, after: orderedKeys, revision: receipt.revisionAfter };
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}
