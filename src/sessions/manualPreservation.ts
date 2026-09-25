import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { resolveActionReadiness, resolveDispatch, isDispatchable } from "../docs/dispatch.js";
import { git, isAncestor, mergesCleanly, samePath } from "../git/worktrees.js";
import { getActiveWorktreeReservation, getRepositoryLease } from "./index.js";
import { dependencyRequiringPreservationCheck } from "./preservationChecks.js";
import { snapshotCandidateCommit } from "./candidateSnapshot.js";

export interface ManualPreservationBinding {
  reservationId: string;
  repository: string;
  worktree: string;
  branch: string;
  baseBranch: string;
  baseRevision: string;
  projectSlug: string;
  actionId: string;
  actionDefinition: string;
  commands: string[];
}

export function ensureManualPreservationTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS manual_preservation_bindings (
    reservation_id TEXT PRIMARY KEY,
    binding_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL
  )`);
}

export function manualBindingFingerprint(binding: ManualPreservationBinding): string {
  return createHash("sha256").update(JSON.stringify(binding)).digest("hex");
}

/** The host freezes only its existing reservation and authoritative Project
 * state. Requests cannot supply commands, branch identities or passing evidence.
 * This grants local candidate preservation only, never managed production. */
export function bindManualPreservation(db: Database.Database, input: {
  repository: string; worktree: string; baseBranch: string; projectSlug: string;
}): ManualPreservationBinding {
  if (process.env.CODEX_SANDBOX) throw validationError("Manual preservation binding must run on the host controller.");
  const reservation = getActiveWorktreeReservation(db, input.repository, input.worktree);
  if (!reservation) throw validationError("Manual preservation requires an active Arcadia worktree reservation.");
  const existing = db.prepare("SELECT binding_json, fingerprint FROM manual_preservation_bindings WHERE reservation_id = ?")
    .get(reservation.id) as { binding_json: string; fingerprint: string } | undefined;
  if (existing) {
    const binding = JSON.parse(existing.binding_json) as ManualPreservationBinding;
    if (manualBindingFingerprint(binding) !== existing.fingerprint) throw validationError("Manual preservation binding is corrupt.");
    assertManualPreservationBinding(db, binding);
    return binding;
  }
  const lease = getRepositoryLease(db, input.repository);
  if (lease) throw validationError("A managed Session already owns this repository; use its preservation path.");
  const dispatch = resolveDispatch(input.repository, input.projectSlug);
  if (!isDispatchable(dispatch) || !dispatch.context) throw validationError("Manual preservation requires the current dispatchable Action.");
  const project = getProjectBySlug(db, input.projectSlug);
  if (!project) throw validationError("Manual preservation Project is not registered.");
  const metadata = getProjectMetadata(db, project.id);
  if (!metadata?.repo_path || !samePath(metadata.repo_path, input.repository)) throw validationError("Manual preservation Project repository changed.");
  let commands: unknown;
  try { commands = JSON.parse(metadata.validation_commands ?? "[]"); } catch { commands = null; }
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > 10 ||
      commands.some(c => typeof c !== "string" || !c.trim() || /[\r\n]/.test(c))) {
    throw validationError("Manual preservation requires 1–10 host-configured objective validation_commands; a planning approval is not the remedy.");
  }
  const dependency = dependencyRequiringPreservationCheck(commands as string[]);
  if (dependency) throw validationError(dependency.remedy);
  const baseRevision = git(input.repository, ["rev-parse", input.baseBranch]).trim();
  if (git(input.worktree, ["rev-parse", "HEAD"]).trim() !== baseRevision) {
    throw validationError("Cannot recover a manual binding after branch history changed; retain the candidate.");
  }
  if (git(input.worktree, ["symbolic-ref", "--short", "HEAD"]).trim() !== reservation.branch) {
    throw validationError("Manual reservation branch changed.");
  }
  const binding: ManualPreservationBinding = {
    reservationId: reservation.id, repository: reservation.repository_path,
    worktree: reservation.worktree_path, branch: reservation.branch,
    baseBranch: input.baseBranch, baseRevision, projectSlug: input.projectSlug,
    actionId: dispatch.context.action.id,
    actionDefinition: JSON.stringify({ plan: dispatch.context.activePlan, action: dispatch.context.action,
      decisions: dispatch.context.requiredDecisions }), commands: commands as string[]
  };
  db.prepare("INSERT INTO manual_preservation_bindings VALUES (?, ?, ?)")
    .run(reservation.id, JSON.stringify(binding), manualBindingFingerprint(binding));
  return binding;
}

export function assertManualPreservationBinding(db: Database.Database, binding: ManualPreservationBinding): void {
  const reservation = getActiveWorktreeReservation(db, binding.repository, binding.worktree);
  if (!reservation || reservation.id !== binding.reservationId || reservation.branch !== binding.branch) {
    throw validationError("Manual preservation reservation changed or expired.");
  }
  if (getRepositoryLease(db, binding.repository)) throw validationError("A managed Session now owns the repository.");
  const row = db.prepare("SELECT binding_json FROM manual_preservation_bindings WHERE reservation_id = ?")
    .get(binding.reservationId) as { binding_json: string } | undefined;
  if (row?.binding_json !== JSON.stringify(binding)) throw validationError("Manual preservation binding changed.");
  if (git(binding.worktree, ["symbolic-ref", "--short", "HEAD"]).trim() !== binding.branch) {
    throw validationError("Manual preservation Git binding changed.");
  }
  const currentBaseRevision = git(binding.repository, ["rev-parse", binding.baseBranch]).trim();
  if (currentBaseRevision !== binding.baseRevision) {
    if (!isAncestor(binding.repository, binding.baseRevision, currentBaseRevision)) {
      throw validationError(
        `Manual preservation base ${binding.baseBranch} changed from ${binding.baseRevision} to ${currentBaseRevision}, which is not a forward advance; reconcile the candidate onto the current base in a fresh worktree before retrying.`,
        { baseBranch: binding.baseBranch, oldBase: binding.baseRevision, newBase: currentBaseRevision }
      );
    }
    const candidateHead = git(binding.worktree, ["rev-parse", "HEAD"]).trim();
    const syntheticCommit = snapshotCandidateCommit(binding.repository, binding.worktree, candidateHead);
    if (!mergesCleanly(binding.repository, syntheticCommit, currentBaseRevision)) {
      throw validationError(
        `Manual preservation base ${binding.baseBranch} advanced from ${binding.baseRevision} to ${currentBaseRevision} and no longer merges cleanly with the candidate; reconcile the candidate onto the current base in a fresh worktree before retrying.`,
        { baseBranch: binding.baseBranch, oldBase: binding.baseRevision, newBase: currentBaseRevision }
      );
    }
  }
  // Look up the bound Action by id across every plan in the Project — not
  // resolveDispatch's current pointer, which may have moved to a different
  // Action (or a claimed-actionId lookup scoped to only the active plan,
  // if active_plan itself changed) since this binding was created. Matches
  // the same resolveActionReadiness pattern preservationValidation.ts already
  // uses for a managed Session's own dispatched Action.
  const readiness = resolveActionReadiness(binding.repository, binding.projectSlug, binding.actionId);
  if (!readiness.found || readiness.blockers.length > 0 || readiness.operatorQuestion) {
    throw validationError("Manual preservation Action authority is no longer ready.", { blockers: readiness.blockers });
  }
  if (binding.actionDefinition !== JSON.stringify({
    plan: readiness.planSlug, action: readiness.action, decisions: readiness.requiredDecisions
  })) throw validationError("Manual preservation Action authority changed.");
  const project = getProjectBySlug(db, binding.projectSlug);
  const metadata = project ? getProjectMetadata(db, project.id) : null;
  if (!metadata?.repo_path || !samePath(metadata.repo_path, binding.repository) ||
      JSON.stringify(JSON.parse(metadata.validation_commands ?? "[]")) !== JSON.stringify(binding.commands)) {
    throw validationError("Manual preservation validation definitions changed.");
  }
}
