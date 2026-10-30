import { withReadOnlyDatabase } from "../db/connection.js";
import { getSession, type AgentSession, type TmuxAdapter } from "../sessions/index.js";
import { toDashboardAgentSession } from "./snapshot.js";

export type SessionTarget = { id: string } | { projectId: string; plan: string; action: string };

/** Exact durable Session read, independent of the portfolio's bounded recent list. */
export function observeDashboardSession(workspace: string, target: SessionTarget, tmux?: Pick<TmuxAdapter, "hasSession">) {
  return withReadOnlyDatabase(workspace, db => {
    const observedAt = new Date().toISOString();
    const known = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'").get());
    if (!known) return { observedAt, known: false, session: null, projectSlug: null };
    const session = "id" in target ? getSession(db, target.id) : db.prepare(`SELECT * FROM agent_sessions
      WHERE project_id = ? AND plan_slug = ? AND action_id = ?
      ORDER BY CASE WHEN status IN ('prepared', 'running') THEN 0 ELSE 1 END,
        prepared_at DESC, id DESC LIMIT 1`).get(target.projectId, target.plan, target.action) as AgentSession | undefined;
    const project = session ? db.prepare("SELECT slug FROM projects WHERE id = ?").get(session.project_id) as { slug: string } | undefined : null;
    return { observedAt, known: true, projectSlug: project?.slug ?? null, session: session ? toDashboardAgentSession(db, session, new Date(observedAt), tmux) : null };
  });
}
