import { workKindFor } from "../classify.js";
import { actorFromRoleActorId, actorFromSession, hostWorkerActor, strongestActor, toolFromWorktreePath } from "../identity.js";
import { timelineEvent, type TimelineEvent } from "../schema.js";
import { capped, hasTable, requireDb, windowParams, type Collector, type CollectorContext } from "./context.js";

/**
 * Managed Sessions (agent_sessions), their role attempts (planner, critique,
 * development, code-review, qa) and their exit receipts. Only Sessions the
 * production worker launched have rows here; interactive sessions appear in
 * the stream through their worktrees, commits and Asks.
 */

interface SessionRow {
  id: string;
  project_slug: string;
  plan_slug: string;
  action_id: string;
  provider: string;
  model: string;
  effort: string | null;
  branch: string;
  worktree_path: string;
  status: string;
  prepared_at: string;
  started_at: string | null;
  ended_at: string | null;
  stall_flagged_at: string | null;
  exit_status: number | null;
  is_simulated: number;
}

interface RoleRow {
  id: string;
  requirement_id: string;
  role: string;
  ordinal: number;
  actor_id: string;
  status: string;
  target_head: string | null;
  created_at: string;
  updated_at: string;
}

interface ExitRow {
  id: string;
  session_id: string;
  outcome: string;
  reason: string;
  candidate_revision: string | null;
  created_at: string;
  project_slug: string | null;
  action_id: string | null;
}

const ATTENTION_EXITS = new Set(["failed_execution", "missing_evidence", "needs_input"]);

export function collectSessions(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  const params = windowParams(context);
  const events: TimelineEvent[] = [];
  const push = (input: Parameters<typeof timelineEvent>[0]) => {
    const event = timelineEvent(input);
    if (event) events.push(event);
  };

  if (hasTable(db, "agent_sessions")) {
    const rows = db.prepare(`
      SELECT id, project_slug, plan_slug, action_id, provider, model, effort, branch, worktree_path, status,
             prepared_at, started_at, ended_at, stall_flagged_at, exit_status, is_simulated
      FROM agent_sessions
      WHERE prepared_at BETWEEN @since AND @until OR started_at BETWEEN @since AND @until
         OR ended_at BETWEEN @since AND @until OR stall_flagged_at BETWEEN @since AND @until
      ORDER BY prepared_at DESC LIMIT @cap`).all(params) as SessionRow[];
    capped(rows, context, events, "sessions", "agent_sessions");
    for (const row of rows) {
      const who = strongestActor([actorFromSession(row), toolFromWorktreePath(row.worktree_path)]);
      const simulated = row.is_simulated ? " [simulated]" : "";
      const subjects = {
        project: row.project_slug,
        plan: row.plan_slug,
        action: row.action_id,
        session: row.id,
        branch: row.branch,
        worktree: row.worktree_path
      };
      const evidence = [{ kind: "row" as const, value: `agent_sessions/${row.id}` }];
      const base = { clock: "workspace-db" as const, source: "sessions" as const, subjects, evidence };
      const launcher = hostWorkerActor("Sessions are prepared by Arcadia's launcher (src/sessions/launch.ts)");
      push({ ...base, id: `sessions:${row.id}:prepared`, time: row.prepared_at, kind: "session.prepared", workKind: workKindFor("session.prepared"), summary: `Session prepared for ${row.action_id} on ${row.provider} (${row.model})${simulated}`, actor: launcher.actor, provenance: { event: "agent_sessions.prepared_at", actor: launcher.provenance } });
      if (row.started_at) {
        push({ ...base, id: `sessions:${row.id}:started`, time: row.started_at, kind: "session.started", workKind: workKindFor("session.started"), summary: `Session started on ${row.action_id}${simulated}`, actor: who.actor, provenance: { event: "agent_sessions.started_at", actor: who.provenance, workKind: "managed Sessions are launched for the development role" } });
      }
      if (row.ended_at) {
        const attention = row.status === "failed" || row.status === "needs_input";
        push({ ...base, id: `sessions:${row.id}:ended`, time: row.ended_at, kind: "session.ended", workKind: workKindFor("session.ended"), summary: `Session ${row.status} on ${row.action_id}${row.exit_status !== null ? ` (exit ${row.exit_status})` : ""}${simulated}`, actor: who.actor, attention, provenance: { event: "agent_sessions.ended_at and status", actor: who.provenance } });
      }
      if (row.stall_flagged_at) {
        push({ ...base, id: `sessions:${row.id}:stalled`, time: row.stall_flagged_at, kind: "session.stalled", workKind: workKindFor("session.stalled"), summary: `Session flagged as stalled on ${row.action_id}`, actor: launcher.actor, attention: true, provenance: { event: "agent_sessions.stall_flagged_at (set by the worker's stall detector)", actor: "the worker flags stalls" }, dedupeKeys: [`session-stalled:${row.id}`] });
      }
    }
  }

  if (hasTable(db, "session_role_attempts")) {
    const rows = db.prepare(`
      SELECT id, requirement_id, role, ordinal, actor_id, status, target_head, created_at, updated_at
      FROM session_role_attempts
      WHERE created_at BETWEEN @since AND @until OR updated_at BETWEEN @since AND @until
      ORDER BY created_at DESC LIMIT @cap`).all(params) as RoleRow[];
    capped(rows, context, events, "sessions", "session_role_attempts");
    for (const row of rows) {
      const [project, plan, action] = row.requirement_id.split("/");
      const who = actorFromRoleActorId(row.actor_id, row.role);
      const kind = `role.${row.role}`;
      const subjects = { project, plan, action, commit: row.target_head ?? undefined };
      const base = {
        clock: "workspace-db" as const,
        source: "sessions" as const,
        kind,
        workKind: workKindFor(kind),
        subjects,
        actor: who.actor,
        evidence: [{ kind: "row" as const, value: `session_role_attempts/${row.id}` }]
      };
      const label = row.role === "qa" ? "QA" : row.role;
      const target = action ?? row.requirement_id;
      const terminal = row.status === "passed" || row.status === "failed";
      // Host roles finish in the same instant they start; one event then says both.
      const instant = terminal && row.updated_at === row.created_at;
      push({
        ...base,
        id: `sessions:role:${row.id}:started`,
        time: row.created_at,
        summary: instant ? `${label} ${row.status} on ${target}` : `${label} attempt ${row.ordinal} started on ${target}`,
        attention: instant && row.status === "failed",
        provenance: { event: "session_role_attempts.created_at", actor: who.provenance, workKind: `role ${row.role}` }
      });
      if (terminal && !instant) {
        push({ ...base, id: `sessions:role:${row.id}:finished`, time: row.updated_at, summary: `${label} ${row.status} on ${target}`, attention: row.status === "failed", provenance: { event: "session_role_attempts.updated_at with a terminal status", actor: who.provenance, workKind: `role ${row.role}` } });
      }
    }
  }

  if (hasTable(db, "session_exit_receipts") && hasTable(db, "agent_sessions")) {
    const rows = db.prepare(`
      SELECT r.id, r.session_id, r.outcome, r.reason, r.candidate_revision, r.created_at, s.project_slug, s.action_id
      FROM session_exit_receipts r LEFT JOIN agent_sessions s ON s.id = r.session_id
      WHERE r.created_at BETWEEN @since AND @until
      ORDER BY r.created_at DESC LIMIT @cap`).all(params) as ExitRow[];
    capped(rows, context, events, "sessions", "session_exit_receipts");
    for (const row of rows) {
      push({
        id: `sessions:exit:${row.id}`,
        time: row.created_at,
        clock: "workspace-db",
        source: "sessions",
        kind: "session.exit_recorded",
        workKind: workKindFor("session.exit_recorded"),
        summary: `Session exit recorded: ${row.outcome.replaceAll("_", " ")}`,
        subjects: { project: row.project_slug ?? undefined, action: row.action_id ?? undefined, session: row.session_id, commit: row.candidate_revision ?? undefined },
        attention: ATTENTION_EXITS.has(row.outcome),
        evidence: [{ kind: "receipt", value: `session_exit_receipts/${row.id}` }],
        provenance: { event: "session_exit_receipts.created_at", actor: "exit receipts are recorded by Arcadia's terminal-recovery path, not by the agent" }
      });
    }
  }
  return events;
}

export const sessionsCollector: Collector = {
  source: "sessions",
  describe: "agent_sessions, session_role_attempts, session_exit_receipts",
  collect: collectSessions
};
