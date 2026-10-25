import type Database from "better-sqlite3";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";

const columns = ["id", "repository_path", "worktree_path", "branch", "created_at", "expires_at", "project", "action_id"] as const;
type Reservation = Record<typeof columns[number], string | null>;

export interface WorkReservationsData {
  schema: "arcadia-worktree-reservation-inventory-v1";
  observedAt: string;
  coverage: "workspace-wide";
  reservations: Reservation[];
  limitation: string;
}

/** No repository filter, history limit, filesystem liveness test or custody cleanup. */
export function readWorktreeReservationInventory(db: Database.Database, now = new Date()): WorkReservationsData {
  const observedAt = now.toISOString();
  const available = new Set((db.prepare("PRAGMA table_info(agent_worktree_reservations)").all() as Array<{ name: string }>).map(row => row.name));
  if (columns.some(column => !available.has(column))) {
    throw validationError("Handoff reservation inventory unavailable: required schema is missing. No migration or cleanup was attempted.");
  }
  // Read every row before filtering: malformed expiry must not look like absent custody.
  // Do not expose claim_generation, which is an ownership fence rather than inventory.
  const rows = db.prepare(`SELECT ${columns.join(", ")} FROM agent_worktree_reservations ORDER BY repository_path, worktree_path, id`).all() as Reservation[];
  for (const row of rows) {
    if (["id", "repository_path", "worktree_path", "branch"].some(field => typeof row[field as keyof Reservation] !== "string" || !row[field as keyof Reservation]!.trim())) {
      throw validationError("Handoff reservation inventory unavailable: invalid reservation identity. No custody was changed.");
    }
    for (const field of ["created_at", "expires_at"] as const) {
      const value = row[field];
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw validationError("Handoff reservation inventory unavailable: invalid reservation timestamp. No custody was changed.");
      }
    }
  }
  return {
    schema: "arcadia-worktree-reservation-inventory-v1",
    observedAt,
    coverage: "workspace-wide",
    reservations: rows.filter(row => row.expires_at! > observedAt),
    limitation: "Point-in-time observation only; not atomic exclusion, owner release, or permission to restart, retire, probe or launch."
  };
}

export function runWorkReservationsCommand(options: { workspace?: string }): CommandSuccess<WorkReservationsData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, db => readWorktreeReservationInventory(db));
  return createSuccess({ command: "work.reservations", workspace: workspacePath, data });
}

export function renderWorkReservationsSuccess(response: CommandSuccess<WorkReservationsData>): string[] {
  const { observedAt, reservations, limitation } = response.data;
  return [
    `Workspace-wide unexpired handoff reservations at ${observedAt}: ${reservations.length}`,
    ...reservations.map(row => `${row.id}: ${row.repository_path} → ${row.worktree_path} (${row.branch}); expires ${row.expires_at}`),
    limitation
  ];
}
