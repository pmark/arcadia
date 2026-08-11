import type Database from "better-sqlite3";
import type { WorkMonitorSnapshot } from "../workMonitoring/types.js";

interface RecentLogRow {
  project_id: string;
  project_name: string;
  work_performed: string;
  result: string;
  blockers: string | null;
  next_action: string;
  created_at: string;
}

interface BlockedActionRow {
  project_id: string;
  title: string;
}

interface PlannedActionRow {
  project_id: string;
  next_action: string;
}

export interface ProjectStandup {
  projectId: string;
  projectName: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
}

export interface MorningNarrativeSnapshot {
  recentLogs: RecentLogRow[];
  projectStandups: ProjectStandup[];
}

/**
 * Gather the portfolio stand-up from durable Logs, planned/blocked Actions,
 * and the read-only working-copy scan.
 *
 * A Project is active here when it has a Log in the trailing seven days, has
 * uncommitted repository work now, or has an unmerged branch whose latest
 * commit is in that same window. This measures recent attention rather than
 * copying the Project lifecycle status.
 */
export function gatherMorningNarrativeSnapshot(
  db: Database.Database,
  now: Date,
  workSnapshot: WorkMonitorSnapshot | null = null
): MorningNarrativeSnapshot {
  const activeSince = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { yesterdayStart, todayStart } = localDayBoundaries(now);
  const nowIso = now.toISOString();
  const recentLogs = db.prepare(
    `SELECT
       ml.project_id,
       p.name AS project_name,
       ml.work_performed,
       ml.result,
       ml.blockers,
       ml.next_action,
       ml.created_at
     FROM mission_logs ml
     JOIN projects p ON p.id = ml.project_id
     WHERE ml.created_at >= ? AND ml.created_at < ?
     ORDER BY ml.created_at DESC, ml.id ASC`
  ).all(activeSince, nowIso) as RecentLogRow[];

  const blockedActions = db.prepare(
    `SELECT wi.project_id, wi.title
     FROM work_items wi
     WHERE wi.project_id IS NOT NULL AND wi.status = 'blocked'
     ORDER BY wi.updated_at DESC, wi.id ASC`
  ).all() as BlockedActionRow[];
  const plannedActions = db.prepare(
    `SELECT wi.project_id, wi.next_action
     FROM work_items wi
     WHERE wi.project_id IS NOT NULL
       AND wi.status IN ('open', 'in_progress')
       AND trim(wi.next_action) != ''
     ORDER BY wi.status = 'in_progress' DESC, wi.updated_at DESC, wi.id ASC`
  ).all() as PlannedActionRow[];

  const projectNames = new Map<string, string>();
  for (const log of recentLogs) projectNames.set(log.project_id, log.project_name);
  for (const repository of workSnapshot?.repositories ?? []) {
    if (repository.workingCopies.some((copy) => isRecentRepositoryAttention(copy, activeSince))) {
      projectNames.set(repository.projectId, repository.projectName);
    }
  }

  const projectStandups = [...projectNames.entries()].map(([projectId, projectName]) => {
    const logs = recentLogs.filter((log) => log.project_id === projectId);
    const yesterdayLogs = logs.filter(
      (log) => log.created_at >= yesterdayStart && log.created_at < todayStart
    );
    const latestNextAction = logs.find((log) => log.next_action.trim())?.next_action;
    const plannedAction = plannedActions.find((action) => action.project_id === projectId)?.next_action;

    return {
      projectId,
      projectName,
      yesterday: unique(yesterdayLogs.map((log) => log.work_performed)),
      today: unique([latestNextAction ?? plannedAction ?? ""]),
      blockers: unique([
        ...blockedActions.filter((action) => action.project_id === projectId).map((action) => action.title),
        ...yesterdayLogs.map((log) => log.blockers).filter((blocker): blocker is string => Boolean(blocker?.trim()))
      ])
    };
  });

  return { recentLogs, projectStandups };
}

function isRecentRepositoryAttention(
  copy: WorkMonitorSnapshot["repositories"][number]["workingCopies"][number],
  activeSince: string
): boolean {
  if (copy.changes.total > 0) return true;
  return copy.preservation !== "landed" && Boolean(
    copy.lastCommitAt && new Date(copy.lastCommitAt).getTime() >= new Date(activeSince).getTime()
  );
}

export function composeMorningNarrative(snapshot: MorningNarrativeSnapshot): string {
  if (snapshot.projectStandups.length === 0) {
    return "No Projects have received a Log entry in the last seven days, so there is no active portfolio docket to report.";
  }

  const doneCount = snapshot.projectStandups.reduce((total, project) => total + project.yesterday.length, 0);
  const plannedCount = snapshot.projectStandups.reduce((total, project) => total + project.today.length, 0);
  const blockerCount = snapshot.projectStandups.reduce((total, project) => total + project.blockers.length, 0);
  const lines = [
    `${snapshot.projectStandups.length} recently active ${plural(snapshot.projectStandups.length, "Project")} on the docket: ` +
      `${doneCount} done ${plural(doneCount, "item")} yesterday, ${plannedCount} planned ${plural(plannedCount, "Action")} today, ` +
      `${blockerCount} ${plural(blockerCount, "blocker")}.`
  ];

  for (const project of snapshot.projectStandups) {
    lines.push(
      `**${project.projectName}**\n` +
      `Yesterday: ${listOrFallback(project.yesterday, "No completed work recorded.")}\n` +
      `Today: ${listOrFallback(project.today, "No next Action recorded.")}\n` +
      `Blockers: ${listOrFallback(project.blockers, "None recorded.")}`
    );
  }

  return lines.join("\n\n");
}

function localDayBoundaries(now: Date): { yesterdayStart: string; todayStart: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return { yesterdayStart: yesterday.toISOString(), todayStart: today.toISOString() };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function listOrFallback(values: string[], fallback: string): string {
  return values.length > 0 ? values.map(sentence).join("; ") : fallback;
}

function sentence(value: string): string {
  const trimmed = value.length > 180 ? `${value.slice(0, 177).trimEnd()}…` : value;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
