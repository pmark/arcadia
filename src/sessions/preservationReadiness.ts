import type Database from "better-sqlite3";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { samePath } from "../git/worktrees.js";
import { getRepositoryLease, getActiveWorktreeReservation } from "./index.js";
import { assertManualPreservationBinding } from "./manualPreservation.js";
import type { ManualPreservationBinding } from "./manualPreservation.js";
import { preservationAuthority } from "./preservationValidation.js";

export interface PreservationReadiness {
  kind: "managed_session" | "manual_handoff";
  ready: boolean;
  sessionId: string | null;
  blockers: Array<{ code: string; reason: string }>;
  operatorDecisionRequired?: false;
}

/** Read the actual preservation boundary. A missing Session is not evidence
 * that the operator owes a planning approval: ordinary Go never creates one.
 * Keep capability/configuration defects distinct from authority decisions. */
export function readPreservationReadiness(db: Database.Database, input: {
  workspace: string;
  repository: string;
  worktree: string;
  projectSlug: string;
}): PreservationReadiness {
  const lease = getRepositoryLease(db, input.repository);
  if (lease && samePath(lease.worktree_path, input.worktree)) {
    try {
      preservationAuthority(db, input.workspace, lease);
      return { kind: "managed_session", ready: true, sessionId: lease.id, blockers: [] };
    } catch (error) {
      return { kind: "managed_session", ready: false, sessionId: lease.id,
        blockers: [{ code: "preservation_prerequisite", reason: error instanceof Error ? error.message : String(error) }] };
    }
  }
  const blockers: PreservationReadiness["blockers"] = [];
  if (input.worktree) {
    const reservation = getActiveWorktreeReservation(db, input.repository, input.worktree);
    if (!reservation) blockers.push({ code: "reservation_missing", reason: "No active manual handoff reserves this worktree." });
    else {
      const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'manual_preservation_bindings'").get();
      const row = table ? db.prepare("SELECT binding_json FROM manual_preservation_bindings WHERE reservation_id = ?")
        .get(reservation.id) as { binding_json: string } | undefined : undefined;
      if (row) {
        try {
          assertManualPreservationBinding(db, JSON.parse(row.binding_json) as ManualPreservationBinding);
          return { kind: "manual_handoff", ready: true, sessionId: null, blockers: [], operatorDecisionRequired: false };
        } catch (error) {
          blockers.push({ code: "manual_binding_changed", reason: error instanceof Error ? error.message : String(error) });
        }
      } else blockers.push({ code: "manual_binding_missing", reason: "The host must bind this reserved manual handoff before preservation; no managed Session or planning approval is required." });
    }
  }
  if (lease) blockers.push({ code: "different_session_worktree", reason: `The existing Session ${lease.id} belongs to another worktree.` });
  const project = getProjectBySlug(db, input.projectSlug);
  const commands = project ? getProjectMetadata(db, project.id)?.validation_commands : null;
  let checks: unknown;
  try { checks = commands ? JSON.parse(commands) : null; } catch { checks = null; }
  if (!Array.isArray(checks) || checks.length === 0) blockers.push({ code: "validation_commands_missing",
    reason: "The Project has no configured preservation validation commands. A planning packet alone cannot make preservation ready." });
  return { kind: "manual_handoff", ready: false, sessionId: null, blockers, operatorDecisionRequired: false };
}
