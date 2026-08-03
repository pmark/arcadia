import type Database from "better-sqlite3";

interface RecentLogRow {
  project_name: string;
  work_performed: string;
  result: string;
  blockers: string | null;
  next_action: string;
  created_at: string;
}

export interface MorningNarrativeSnapshot {
  recentLogs: RecentLogRow[];
  completedActions7d: number;
  completedActionsPrevious7d: number;
  readyArtifacts7d: number;
  pendingDecisions: number;
  blockedActions: number;
}

/** Gather only durable operational facts; narration below remains deterministic. */
export function gatherMorningNarrativeSnapshot(db: Database.Database, now: Date): MorningNarrativeSnapshot {
  const current = now.getTime();
  const sevenDaysAgo = new Date(current - 7 * 86_400_000).toISOString();
  const fourteenDaysAgo = new Date(current - 14 * 86_400_000).toISOString();
  const nowIso = now.toISOString();
  const count = (sql: string, ...params: string[]): number =>
    (db.prepare(sql).get(...params) as { count: number }).count;

  return {
    recentLogs: db.prepare(
      `SELECT p.name AS project_name, ml.work_performed, ml.result, ml.blockers, ml.next_action, ml.created_at
       FROM mission_logs ml
       LEFT JOIN projects p ON p.id = ml.project_id
       WHERE ml.created_at >= ? AND ml.created_at < ?
       ORDER BY ml.created_at DESC
       LIMIT 5`
    ).all(sevenDaysAgo, nowIso) as RecentLogRow[],
    completedActions7d: count(
      "SELECT COUNT(*) AS count FROM work_items WHERE status = 'done' AND updated_at >= ? AND updated_at < ?",
      sevenDaysAgo,
      nowIso
    ),
    completedActionsPrevious7d: count(
      "SELECT COUNT(*) AS count FROM work_items WHERE status = 'done' AND updated_at >= ? AND updated_at < ?",
      fourteenDaysAgo,
      sevenDaysAgo
    ),
    readyArtifacts7d: count(
      "SELECT COUNT(*) AS count FROM artifacts WHERE status IN ('ready', 'published') AND updated_at >= ? AND updated_at < ?",
      sevenDaysAgo,
      nowIso
    ),
    pendingDecisions: count("SELECT COUNT(*) AS count FROM review_items WHERE status = 'pending'"),
    blockedActions: count("SELECT COUNT(*) AS count FROM work_items WHERE status = 'blocked'")
  };
}

export function composeMorningNarrative(snapshot: MorningNarrativeSnapshot): string {
  const lines: string[] = [];
  if (snapshot.recentLogs.length > 0) {
    const projects = [...new Set(snapshot.recentLogs.map((log) => log.project_name || "Unassigned"))];
    const highlights = snapshot.recentLogs
      .slice(0, 3)
      .map((log) => `${log.project_name || "Unassigned"}: ${sentence(log.result)}`)
      .join(" ");
    lines.push(
      `Momentum is visible across ${projects.length} ${projects.length === 1 ? "Project" : "Projects"}. ` +
      `Recent changes: ${highlights}`
    );
  } else {
    lines.push("Arcadia has no new Log entries from the last seven days, so the useful move is to restore one small, provable thread of momentum.");
  }

  const comparison = snapshot.completedActions7d - snapshot.completedActionsPrevious7d;
  const velocity = comparison === 0
    ? "steady with the preceding week"
    : comparison > 0
      ? `up by ${comparison} from the preceding week`
      : `down by ${Math.abs(comparison)} from the preceding week`;
  lines.push(
    `Velocity: ${snapshot.completedActions7d} completed ${plural(snapshot.completedActions7d, "Action")} and ` +
    `${snapshot.readyArtifacts7d} ready ${plural(snapshot.readyArtifacts7d, "Artifact")} in seven days; completed-Action throughput is ${velocity}.`
  );

  const friction: string[] = [];
  if (snapshot.pendingDecisions > 0) friction.push(`${snapshot.pendingDecisions} pending ${plural(snapshot.pendingDecisions, "Decision")}`);
  if (snapshot.blockedActions > 0) friction.push(`${snapshot.blockedActions} blocked ${plural(snapshot.blockedActions, "Action")}`);
  const loggedBlocker = snapshot.recentLogs.find((log) => log.blockers?.trim());
  if (loggedBlocker) friction.push(`${loggedBlocker.project_name}: ${sentence(loggedBlocker.blockers ?? "")}`);
  lines.push(friction.length > 0
    ? `Watch the drag: ${stripTerminalPunctuation(friction.join("; "))}. Clearing the smallest one first is likely the cheapest way to recover flow.`
    : "No explicit blocked Actions or pending Decisions are accumulating. Protect that low-friction state by finishing the smallest ready slice before opening another front."
  );

  const next = snapshot.recentLogs.find((log) => log.next_action?.trim())?.next_action;
  if (next) lines.push(`Best handoff opportunity: ${sentence(next)} If its inputs are complete, this is a strong candidate for direct coding-agent delegation.`);
  return lines.join("\n\n");
}

function sentence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const trimmed = normalized.length > 240 ? `${normalized.slice(0, 237).trimEnd()}…` : normalized;
  if (!trimmed) return "No result was recorded.";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.!?]+$/, "");
}
