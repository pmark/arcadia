import { projectNotFound } from "../cli/errors.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { discoverDocs, withDocsSnapshot, type DiscoveryIoError } from "../docs/discover.js";
import { hasWorktreeReservationTable, listActiveAgentSessions } from "../sessions/index.js";
import { runNextReadOnlyCommand, type NextCommandData } from "./next.js";

interface ObservationError {
  message: string;
  code: string | null;
  source: string;
  remedy: string;
}
export interface GoProjectContext {
  project: { id: string; slug: string; name: string; status: string };
  repoRoot: string | null;
  source: "managed-documents+canonical-workspace";
  observedAt: string;
  resolution: NextCommandData | null;
  error: ObservationError | null;
  discoveryErrors: DiscoveryIoError[];
  ownership: {
    source: "canonical-workspace";
    observedAt: string;
    /** Missing legacy tables are unknown, rather than proof of no ownership. */
    claimsKnown: boolean;
    sessionsKnown: boolean;
    claims: Array<{ id: string; action: string | null; status: "reserved"; expiresAt: string }>;
    sessions: Array<{ id: string; plan: string; action: string; status: string }>;
  };
}

/** Observer transport only: dispatch and gate rules remain in the existing next resolver. */
export function runGoContextCommand(options: { workspace: string; project?: string; now?: Date }) {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  return withDocsSnapshot(() => withReadOnlyDatabase(workspacePath, db => {
    const registry = listProjects(db).sort((a, b) => a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id));
    const projects = options.project ? registry.filter(project => project.id === options.project || project.slug === options.project) : registry;
    if (options.project && projects.length === 0) throw projectNotFound(options.project);
    const claimsKnown = hasWorktreeReservationTable(db);
    const sessionsKnown = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_sessions'").get());
    const claims = claimsKnown ? db.prepare(`SELECT id, project, action_id, expires_at FROM agent_worktree_reservations
      WHERE expires_at > ? ORDER BY created_at, id`).all(observedAt) as Array<{ id: string; project: string | null; action_id: string | null; expires_at: string }> : [];
    const sessions = listActiveAgentSessions(db);
    const rows: GoProjectContext[] = projects.map(project => {
      const row: GoProjectContext = {
        project: { id: project.id, slug: project.slug, name: project.name, status: project.status },
        repoRoot: null, source: "managed-documents+canonical-workspace", observedAt,
        resolution: null, error: null, discoveryErrors: [],
        ownership: { source: "canonical-workspace", observedAt, claimsKnown, sessionsKnown,
          claims: claims.filter(claim => claim.project === project.slug).map(claim => ({ id: claim.id, action: claim.action_id, status: "reserved", expiresAt: claim.expires_at })),
          sessions: sessions.filter(session => session.project_id === project.id).sort((a, b) => a.id.localeCompare(b.id))
            .map(session => ({ id: session.id, plan: session.plan_slug, action: session.action_id, status: session.status })) }
      };
      try {
        row.repoRoot = getProjectMetadata(db, project.id)?.repo_path?.trim() || null;
        // No repo option: an operator observes selected Project work, not the
        // server checkout's caller assignment. This path never journals.
        row.resolution = runNextReadOnlyCommand({ workspace: workspacePath, project: project.id, now }).data;
        row.discoveryErrors = discoverDocs(row.resolution.repoRoot).ioErrors ?? [];
      } catch (error) {
        const details = error && typeof error === "object" && "details" in error && error.details && typeof error.details === "object" ? error.details : null;
        row.error = {
          message: error instanceof Error ? error.message : String(error),
          code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null,
          source: row.repoRoot ?? "canonical-workspace:project_metadata.repo_path",
          remedy: details && "remedy" in details && typeof details.remedy === "string" ? details.remedy : "Restore readable Project evidence through its existing governed path, then read Go again."
        };
      }
      return row;
    });
    return createSuccess({ command: "go-context", workspace: workspacePath, data: {
      observedAt, projects: rows,
      summary: { total: rows.length, dispatchable: rows.filter(row => row.resolution?.dispatchable).length,
        unreadable: rows.filter(row => row.error || row.discoveryErrors.length).length,
        gated: rows.filter(row => row.resolution && !row.resolution.dispatchable).length }
    } });
  }));
}
