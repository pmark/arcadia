import type { ArcadiaError } from "../cli/errors.js";

/**
 * The error code recorded with a failed command in `activity_events`.
 *
 * Most failures keep their CLI error code. A few contention refusals all
 * arrive as a generic VALIDATION_ERROR or SQLITE_ERROR, and telling them apart
 * is the whole point of measuring contention (Decision 0082), so they get
 * their own codes:
 *
 * - `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` / `SQLITE_LOCKED`: another writer
 *   held the workspace database;
 * - `QUEUE_REVISION_CONFLICT`: the portfolio queue moved under a preview;
 * - `STALE_PREVIEW_FINGERPRINT`: an apply no longer matches its preview;
 * - `DIRTY_CHECKOUT`: a checkout had uncommitted changes Arcadia will not touch.
 */
export function activityErrorCode(error: unknown, normalized: ArcadiaError): string {
  const sqlite = sqliteCode(error);
  if (sqlite) return sqlite;
  const cause = typeof normalized.details.cause === "string" ? normalized.details.cause : "";
  if (normalized.code === "SQLITE_ERROR" && /database is locked|SQLITE_BUSY/i.test(cause)) return "SQLITE_BUSY";
  if (normalized.code === "VALIDATION_ERROR" || normalized.code === "USAGE_ERROR") {
    const message = normalized.message;
    if (/queue revision changed|queue undo is stale/i.test(message)) return "QUEUE_REVISION_CONFLICT";
    if (/does not match the current preview|preview is stale/i.test(message)) return "STALE_PREVIEW_FINGERPRINT";
    if (/ is not clean;|uncommitted changes|clean, committed snapshot/i.test(message)) return "DIRTY_CHECKOUT";
  }
  return normalized.code;
}

/** The SQLite result code carried by the error or anything in its cause chain. */
function sqliteCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^SQLITE_(BUSY|LOCKED)/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
