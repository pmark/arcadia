import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { ArcadiaError, validationError } from "../cli/errors.js";

/**
 * How many times the same preservation refusal may repeat for one subject (a
 * Session id, or a manual binding's reservation id) before the caller must
 * stop retrying and hand the candidate to an operator or a fresh repair
 * attempt, rather than looping on tokens forever. A refusal for a *different*
 * reason never counts against this budget -- a changed reason is evidence of
 * real repair progress, not a stuck loop.
 */
export const MAX_IDENTICAL_PRESERVATION_REFUSALS = 3;

export function ensurePreservationRefusalTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS preservation_refusal_attempts (
    subject_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    last_reason TEXT NOT NULL,
    first_attempt_at TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL
  )`);
}

/**
 * A stable fingerprint of a refusal's cause: its message and structured
 * details. Two refusals are "identical" when this fingerprint matches,
 * whatever their timestamps or a fresh evidence path happen to be -- callers
 * must strip volatile fields (e.g. `evidenceRef`) from `details` before
 * fingerprinting, since those change on every attempt by construction.
 */
export function fingerprintPreservationRefusal(message: string, details: unknown): string {
  return createHash("sha256").update(JSON.stringify({ message, details })).digest("hex");
}

export interface PreservationRefusalRecord {
  attempts: number;
  fingerprint: string;
}

/**
 * Record one refusal for `subjectId`. Consecutive identical refusals
 * (matching fingerprint) accumulate; a refusal for a new reason resets the
 * count to 1.
 */
export function recordPreservationRefusal(
  db: Database.Database,
  subjectId: string,
  fingerprint: string,
  reason: string,
  now: Date
): PreservationRefusalRecord {
  ensurePreservationRefusalTable(db);
  const at = now.toISOString();
  const existing = db
    .prepare("SELECT attempts, fingerprint, first_attempt_at FROM preservation_refusal_attempts WHERE subject_id = ?")
    .get(subjectId) as { attempts: number; fingerprint: string; first_attempt_at: string } | undefined;
  const attempts = existing && existing.fingerprint === fingerprint ? existing.attempts + 1 : 1;
  const firstAttemptAt = existing && existing.fingerprint === fingerprint ? existing.first_attempt_at : at;
  db.prepare(
    `INSERT INTO preservation_refusal_attempts (subject_id, fingerprint, attempts, last_reason, first_attempt_at, last_attempt_at)
       VALUES (@subject_id, @fingerprint, @attempts, @last_reason, @first_attempt_at, @last_attempt_at)
     ON CONFLICT(subject_id) DO UPDATE SET
       fingerprint = @fingerprint, attempts = @attempts, last_reason = @last_reason,
       first_attempt_at = @first_attempt_at, last_attempt_at = @last_attempt_at`
  ).run({
    subject_id: subjectId,
    fingerprint,
    attempts,
    last_reason: reason,
    first_attempt_at: firstAttemptAt,
    last_attempt_at: at
  });
  return { attempts, fingerprint };
}

/**
 * Clear a subject's refusal history once preservation succeeds (or the
 * subject is retired), so a later, unrelated Session for the same repository
 * never inherits a stale count.
 */
export function clearPreservationRefusal(db: Database.Database, subjectId: string): void {
  ensurePreservationRefusalTable(db);
  db.prepare("DELETE FROM preservation_refusal_attempts WHERE subject_id = ?").run(subjectId);
}

export function getPreservationRefusalAttempts(db: Database.Database, subjectId: string): number {
  ensurePreservationRefusalTable(db);
  const row = db.prepare("SELECT attempts FROM preservation_refusal_attempts WHERE subject_id = ?").get(subjectId) as
    | { attempts: number }
    | undefined;
  return row?.attempts ?? 0;
}

/**
 * Run one preservation validation attempt bound to `subjectId` (a Session id,
 * or a manual binding's reservation id), and refuse to keep retrying an
 * identical refusal forever. A refusal that repeats with the same message and
 * details (minus the always-fresh `evidenceRef`) counts against the budget; a
 * refusal for a genuinely different reason resets it, since that is evidence
 * of real repair progress. Exceeding the budget invokes `onLimitReached` (so
 * the caller can reconcile a managed Session as a non-resumable incomplete
 * exit) and then rethrows a distinct, clearly worded refusal so nothing keeps
 * retrying automatically. Shared by both call paths that validate a
 * candidate for the same Session: the CLI `arcadia preserve` broker
 * (`runPreserveCommand`) and the managed-production tick's own terminal-exit
 * handoff (`preserveSessionCandidate`) -- both key the budget on the same
 * `subjectId` (the Session id), so attempts from either path accumulate
 * against one shared count.
 */
export function guardPreservationRefusal<T>(
  db: Database.Database,
  subjectId: string,
  now: Date,
  run: () => T,
  onLimitReached?: (attempts: number, error: ArcadiaError) => void
): T {
  let result: T;
  try {
    result = run();
  } catch (error) {
    if (!(error instanceof ArcadiaError)) throw error;
    const { evidenceRef: _evidenceRef, ...stableDetails } = error.details;
    const fingerprint = fingerprintPreservationRefusal(error.message, stableDetails);
    const { attempts } = recordPreservationRefusal(db, subjectId, fingerprint, error.message, now);
    if (attempts >= MAX_IDENTICAL_PRESERVATION_REFUSALS) {
      onLimitReached?.(attempts, error);
      throw validationError(
        `Preservation refused an identical reason ${attempts} times in a row: ${error.message} ` +
          "This candidate will not be retried automatically; an operator or a fresh repair attempt must resolve the underlying failure.",
        { ...error.details, identicalRefusalLimitReached: true, attempts }
      );
    }
    throw error;
  }
  clearPreservationRefusal(db, subjectId);
  return result;
}
