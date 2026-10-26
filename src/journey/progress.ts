import type Database from "better-sqlite3";

export interface ProgressEvidence {
  at: string;
  action: string;
  source: string;
  id: string;
  sessionId: string;
  kind: "delivered" | "cleared" | "failed";
  url: string | null;
}
export interface ProgressService {
  service: string;
  configuredModel: string | null;
  configuredEffort: string | null;
  runtimeModel: null;
  runtimeEffort: null;
  workType: "managed development Session";
  sessions: number;
  closedSpans: number;
  sessionHours: number | null;
  delivered: number;
  failed: number;
  sessionIds: string[];
  source: "agent_sessions";
}
export interface ProgressWindow {
  services: ProgressService[];
  start: string;
  end: string;
  elapsedDays: number;
  delivered: number;
  cleared: number;
  failed: number;
  deliveredPerDay: number;
  clearedPerDay: number;
  sessionHours: number | null;
  occupiedHours: number | null;
  sessionsWithoutBounds: number;
  evidence: ProgressEvidence[];
}
export interface JourneyProgress {
  generatedAt: string;
  timezone: "UTC";
  periods: Array<{ days: number; current: ProgressWindow; previous: ProgressWindow }>;
  limitations: string[];
}
interface Session { id: string; action_id: string; provider: string; model: string | null; effort: string | null; prepared_at: string; started_at: string | null; ended_at: string | null }
const DAY = 86_400_000;

/** Equal rolling windows, half-open [start, end). No inference from today's Action status. */
export function deriveJourneyProgress(db: Database.Database, project: string, plan: string, actions: string[], now: Date): JourneyProgress {
  const has = (table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const sessions = has("agent_sessions") ? (db.prepare(`SELECT id, action_id, provider, model, effort, prepared_at, started_at, ended_at FROM agent_sessions
    WHERE project_slug=? AND plan_slug=? AND is_simulated=0`).all(project, plan) as Session[]).filter(s => actions.includes(s.action_id)) : [];
  const byId = new Map(sessions.map(s => [s.id, s]));
  const evidence: ProgressEvidence[] = [];
  const seen = new Set<string>();
  const add = (item: ProgressEvidence) => {
    const key = `${item.kind}:${item.id}`;
    if (!seen.has(key) && Number.isFinite(Date.parse(item.at))) { seen.add(key); evidence.push(item); }
  };
  if (byId.size && has("production_worker_merges")) {
    const rows = db.prepare(`SELECT m.session_id, m.action_key, m.head, m.pull_request_url, m.updated_at FROM production_worker_merges m
      JOIN agent_sessions s ON s.id=m.session_id WHERE m.outcome='merged' AND s.project_slug=? AND s.plan_slug=? AND s.is_simulated=0 ORDER BY m.updated_at`).all(project,plan) as Array<{session_id: string; action_key: string; head: string; pull_request_url: string | null; updated_at: string}>;
    for (const row of rows) {
      const session = byId.get(row.session_id);
      if (session && row.action_key === `${project}/${session.action_id}`) add({ at: row.updated_at, action: session.action_id, source: "production_worker_merges", sessionId: session.id, id: `${row.action_key}:${row.head}`, kind: "delivered", url: row.pull_request_url });
    }
  }
  if (byId.size && has("production_red_alerts")) {
    const rows = db.prepare(`SELECT r.id, r.action_key, r.session_id, r.cleared_at FROM production_red_alerts r
      JOIN agent_sessions s ON s.id=r.session_id WHERE r.status='cleared' AND r.cleared_at IS NOT NULL AND s.project_slug=? AND s.plan_slug=? AND s.is_simulated=0`).all(project,plan) as Array<{id: string; action_key: string; session_id: string | null; cleared_at: string}>;
    for (const row of rows) {
      const session = row.session_id ? byId.get(row.session_id) : null;
      if (session && row.action_key === `${project}/${session.action_id}`) add({ at: row.cleared_at, action: session.action_id, source: "production_red_alerts", sessionId: session.id, id: row.id, kind: "cleared", url: null });
    }
  }
  if (byId.size && has("session_exit_receipts")) {
    const rows = db.prepare(`SELECT e.session_id, e.outcome, e.created_at FROM session_exit_receipts e
      JOIN agent_sessions s ON s.id=e.session_id WHERE e.outcome <> 'accepted_completion' AND s.project_slug=? AND s.plan_slug=? AND s.is_simulated=0 ORDER BY e.created_at`).all(project,plan) as Array<{session_id: string; outcome: string; created_at: string}>;
    for (const row of rows) {
      const session = byId.get(row.session_id);
      if (session) add({ at: row.created_at, action: session.action_id, source: "session_exit_receipts", sessionId: session.id, id: row.session_id, kind: "failed", url: null });
    }
  }
  evidence.sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const window = (start: number, end: number): ProgressWindow => {
    const items = evidence.filter(e => Date.parse(e.at) >= start && Date.parse(e.at) < end);
    const spans: Array<[number, number]> = [];
    let missing = 0;
    const groups = new Map<string, ProgressService>();
    for (const session of sessions) {
      const from = Date.parse(session.started_at ?? session.prepared_at);
      const to = Date.parse(session.ended_at ?? "");
      const overlaps = Number.isFinite(from) && (Number.isFinite(to) ? to > start && from < end : from >= start && from < end);
      if (!overlaps && !items.some(item => item.sessionId === session.id)) continue;
      const key = JSON.stringify([session.provider,session.model,session.effort]);
      let group = groups.get(key);
      if (!group) {
        group = { service: session.provider, configuredModel: session.model, configuredEffort: session.effort, runtimeModel: null, runtimeEffort: null,
          workType: "managed development Session", sessions: 0, closedSpans: 0, sessionHours: null, delivered: 0, failed: 0, sessionIds: [], source: "agent_sessions" };
        groups.set(key,group);
      }
      group.sessions++; group.sessionIds.push(session.id);
      const started = Date.parse(session.started_at ?? "");
      if (Number.isFinite(started) && Number.isFinite(to) && to >= started && to > start && started < end) {
        group.closedSpans++;
        group.sessionHours = (group.sessionHours ?? 0) + (Math.min(to,end)-Math.max(started,start))/3_600_000;
      }
      group.delivered += items.filter(item => item.sessionId === session.id && item.kind === "delivered").length;
      group.failed += items.filter(item => item.sessionId === session.id && item.kind === "failed").length;
    }
    for (const session of sessions) {
      const from = Date.parse(session.started_at ?? "");
      const to = Date.parse(session.ended_at ?? "");
      // Open-ended Sessions cannot prove elapsed effort. Do not extrapolate to now.
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) { missing++; continue; }
      const clipped: [number, number] = [Math.max(start, from), Math.min(end, to)];
      if (clipped[1] > clipped[0]) spans.push(clipped);
    }
    spans.sort((a,b) => a[0]-b[0]);
    let occupied = 0, lastEnd = start;
    for (const [from,to] of spans) { occupied += Math.max(0,to-Math.max(from,lastEnd)); lastEnd = Math.max(lastEnd,to); }
    const delivered = items.filter(e => e.kind === "delivered").length;
    const cleared = items.filter(e => e.kind === "cleared").length;
    const days = (end-start)/DAY;
    return { services: [...groups.values()].sort((a,b) => JSON.stringify([a.service,a.configuredModel,a.configuredEffort]).localeCompare(JSON.stringify([b.service,b.configuredModel,b.configuredEffort]))), start: new Date(start).toISOString(), end: new Date(end).toISOString(), elapsedDays: days, delivered, cleared,
      failed: items.filter(e => e.kind === "failed").length, deliveredPerDay: delivered/days, clearedPerDay: cleared/days,
      sessionHours: spans.length ? spans.reduce((sum,[from,to]) => sum+to-from,0)/3_600_000 : null,
      occupiedHours: spans.length ? occupied/3_600_000 : null, sessionsWithoutBounds: missing, evidence: items };
  };
  const end = now.getTime();
  return { generatedAt: now.toISOString(), timezone: "UTC", periods: [1,7,30].map(days => ({ days, current: window(end-days*DAY,end), previous: window(end-2*days*DAY,end-days*DAY) })), limitations: [
    "Service/model/effort groups use agent_sessions launch configuration, not runtime observation. Runtime model/effort and per-Session usage are unknown; no provider defaults are substituted. Work type is managed development Session; finer task classification and independent reviewer effort are not bound here. Outcomes are linked to their originating Session, not proof of comparative model effectiveness. Groups include Sessions with a span/start or dated outcome in the window; counts are denominators, not rankings.",
    "Recorded subset, not all work: only real managed Sessions in this Plan's current Actions. Simulations and records without a matching real Session are excluded. Zero means no qualifying evidence, not no work.",
    "Delivered counts unique Action/head worker merges; preserved PRs, review passes, accepted Session exits and document Done status are not deliveries. Manual merges and work outside managed Sessions are absent.",
    "Cleared counts unique alert IDs at their recorded cleared_at time, not obstacle importance. Reopened alerts overwrite prior episodes; historical clears, launch refusals and obstacles without a dated clear are absent. Reopening counts are unknown.",
    "Unaccepted exits count unique Sessions, including repeated failures and interruptions, not distinct defects. Rework effort cannot be isolated.",
    "Session elapsed hours include waiting and sum overlaps; occupied hours union those spans. Active agent effort, human effort, tokens and cost are unknown. Only closed valid spans are measured; missing bounds count is all-history for this scope.",
    "Rolling windows use elapsed 24-hour days in UTC, including quiet time. Refresh time does not establish historical coverage; missing history cannot be backfilled from current state."
  ] };
}
