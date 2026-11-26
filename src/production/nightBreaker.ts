import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { writeTransaction } from "../db/connection.js";
import { OPERATOR_PING_MESSAGE_MAX, queueOperatorPing } from "../ping/operatorPing.js";
import {
  BREAKER_WINDOW_MS,
  evaluateNightBreaker,
  recordFailedCondition,
  type BreakerTrip,
  type FailedCondition,
  type ParkReceipt
} from "./parkAndContinue.js";
import { deactivateProduction, readProductionPolicySafely } from "./policy.js";

/**
 * The night breaker's persistence and delivery (#3047; Plan one-stop-never-ends-the-card-20261126). parkAndContinue.ts
 * decides; this module stores its park receipts, runs its verdict on every production tick pass, and, when it trips,
 * turns production Off once with a receipt and queues one attention ping naming the trip kind.
 *
 * The breaker only ever stops production sooner. It reads no lane merges, lane tokens or Claude window yet (no lane
 * exists in the tick; the Claude window is already a capacity hold), so only the park count and the same cause twice can
 * trip it. Every trip is production-wide Off: no lane pause exists to issue instead.
 *
 * A trip answers the parks it counted: a later pass, after the operator grants production again, counts only parks
 * recorded after the latest trip, so one set of parks pages once instead of turning every new grant Off for 24 hours.
 */

/** Request ids of the breaker's own Off: `night-breaker-r<policy revision>`, one per policy revision. */
export const NIGHT_BREAKER_REQUEST_PREFIX = "night-breaker-r";
/** The trip kind for the same cause twice, which parkAndContinue reports as a reason rather than a `BreakerTrip`. */
export const SAME_CAUSE_TRIP = "same-cause";
export type NightBreakerTripKind = BreakerTrip | typeof SAME_CAUSE_TRIP;

export interface NightBreakerPass {
  /** False when production was not Active, so there was nothing to turn Off. */
  evaluated: boolean;
  tripped: boolean;
  trips: NightBreakerTripKind[];
  reasons: string[];
  /** The Off's request id when this pass tripped. */
  requestId: string | null;
}

export function ensureNightBreakerTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_park_receipts (
      id TEXT PRIMARY KEY,
      action_key TEXT NOT NULL,
      condition TEXT NOT NULL,
      cause TEXT NOT NULL,
      cause_kind TEXT NOT NULL CHECK (cause_kind IN ('condition-failed', 'operator-cancel')),
      project TEXT NOT NULL,
      lane TEXT NOT NULL,
      head TEXT,
      reason TEXT,
      parked_at INTEGER NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_production_park_receipts_parked_at ON production_park_receipts(parked_at);
    CREATE TABLE IF NOT EXISTS production_night_breaker_trips (
      request_id TEXT PRIMARY KEY,
      policy_revision INTEGER NOT NULL,
      trips_json TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      message TEXT NOT NULL,
      tripped_at INTEGER NOT NULL,
      ping_id TEXT
    );
    CREATE TABLE IF NOT EXISTS production_action_parks (
      action_key TEXT PRIMARY KEY,
      condition TEXT NOT NULL,
      cause TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      parked_at INTEGER NOT NULL
    );
  `);
}

/**
 * End this Action's park (read by `parkedActionCondition`, src/production/terminalCandidates.ts), if it has one; reads
 * first so an idle pass writes nothing. The receipts stay as history. A missing table has nothing to end.
 */
export function releaseActionPark(db: Database.Database, actionKey: string): void {
  try {
    if (!db.prepare("SELECT 1 FROM production_action_parks WHERE action_key = ?").get(actionKey)) return;
  } catch { return; }
  db.prepare("DELETE FROM production_action_parks WHERE action_key = ?").run(actionKey);
}

interface ParkRow {
  action_key: string;
  condition: string;
  cause: string;
  cause_kind: ParkReceipt["causeKind"];
  project: string;
  lane: string;
  head: string | null;
  reason: string | null;
  parked_at: number;
}

function latestTripAt(db: Database.Database): number | null {
  const row = db.prepare("SELECT MAX(tripped_at) AS at FROM production_night_breaker_trips").get() as { at: number | null };
  return row.at;
}

/**
 * The parks the breaker counts at `now`: inside the rolling 24 hours, after the latest trip, and one per Action (its
 * latest), as parkAndContinue's own ParkState keeps them.
 */
export function listProductionParks(db: Database.Database, now: number): ParkReceipt[] {
  ensureNightBreakerTables(db);
  const since = Math.max(now - BREAKER_WINDOW_MS, latestTripAt(db) ?? Number.NEGATIVE_INFINITY);
  const rows = db.prepare("SELECT * FROM production_park_receipts WHERE parked_at > ? AND parked_at <= ? ORDER BY parked_at, id")
    .all(Number.isFinite(since) ? since : -1, now) as ParkRow[];
  const latest = new Map<string, ParkReceipt>();
  for (const row of rows) {
    latest.delete(row.action_key);
    latest.set(row.action_key, {
      actionKey: row.action_key, condition: row.condition, cause: row.cause, causeKind: row.cause_kind,
      project: row.project, lane: row.lane, parkedAt: row.parked_at, head: row.head,
      ...(row.reason !== null ? { reason: row.reason } : {}),
      ...(row.cause_kind === "operator-cancel" ? { preservedAs: "draft" as const } : {})
    });
  }
  return [...latest.values()];
}

/**
 * Record one failed condition through `recordFailedCondition` and keep its park receipt. A sign-in, capacity or outage
 * hold and main going red write nothing (they are not parks). The returned outcome is parkAndContinue's own; the Off for
 * a third park or the same cause twice is issued by `applyNightBreaker`, which the tick runs on every pass, so a caller
 * that admits more work in the same pass runs it right after recording.
 */
export function recordProductionPark(db: Database.Database, failure: FailedCondition): ReturnType<typeof recordFailedCondition> {
  ensureNightBreakerTables(db);
  return writeTransaction(db, () => {
    const outcome = recordFailedCondition({ parks: listProductionParks(db, failure.now) }, failure);
    if (outcome.kind !== "park") return outcome;
    const r = outcome.receipt;
    const id = `park_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    db.prepare(
      `INSERT INTO production_park_receipts (id, action_key, condition, cause, cause_kind, project, lane, head, reason, parked_at, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, r.actionKey, r.condition, r.cause, r.causeKind, r.project, r.lane, r.head, r.reason ?? null, r.parkedAt, new Date(failure.now).toISOString());
    db.prepare(
      `INSERT INTO production_action_parks (action_key, condition, cause, receipt_id, parked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(action_key) DO UPDATE SET condition = excluded.condition, cause = excluded.cause, receipt_id = excluded.receipt_id, parked_at = excluded.parked_at`
    ).run(r.actionKey, r.condition, r.cause, id, r.parkedAt);
    return outcome;
  });
}

function bounded(message: string): string {
  return message.length <= OPERATOR_PING_MESSAGE_MAX ? message : `${message.slice(0, OPERATOR_PING_MESSAGE_MAX - 1)}…`;
}

/** Queue the page of every trip whose page is not yet queued; the request id in the text keeps it to one ping. */
function deliverTripPings(db: Database.Database, now: Date, log: (message: string) => void): void {
  const pending = db.prepare("SELECT request_id, message FROM production_night_breaker_trips WHERE ping_id IS NULL ORDER BY tripped_at")
    .all() as Array<{ request_id: string; message: string }>;
  for (const trip of pending) {
    try {
      const queued = queueOperatorPing(db, { message: trip.message, kind: "attention", agent: "production-tick", episodeKey: `(${trip.request_id})`, now });
      db.prepare("UPDATE production_night_breaker_trips SET ping_id = ? WHERE request_id = ?").run(queued.ping.id, trip.request_id);
    } catch (error) {
      log(`Night breaker page for ${trip.request_id} not queued yet (retried next pass): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * One pass of the night breaker, run by the production tick before scheduling and admission. While production is
 * Active it evaluates every project and lane that has a counted park; the first verdict that pages turns production Off
 * through `deactivateProduction` (request id `night-breaker-r<revision>`, the trip recorded in the same transaction) and
 * queues one attention ping naming the trip kind. A page not yet queued is retried on every later pass, Active or not.
 */
export function applyNightBreaker(db: Database.Database, input: { now: Date; log?: (message: string) => void }): NightBreakerPass {
  const log = input.log ?? (() => {});
  ensureNightBreakerTables(db);
  const idle: NightBreakerPass = { evaluated: false, tripped: false, trips: [], reasons: [], requestId: null };
  let result = idle;
  const read = readProductionPolicySafely(db);
  if (read.status === "ok" && read.policy.desiredState === "active") {
    const now = input.now.getTime();
    const parks = listProductionParks(db, now);
    result = { ...idle, evaluated: true };
    const lanes = [...new Map(parks.map((p) => [`${p.project}\u0000${p.lane}`, p])).values()];
    for (const { project, lane } of lanes) {
      const verdict = evaluateNightBreaker({
        project, lane, now, parks,
        // Not read yet: no lane exists in the tick to attribute merges or tokens to, and the Claude window is already a
        // capacity hold. Empty and null inputs can never trip, so only parks and the same cause twice can.
        merges: [], laneFirstAdmissionAt: null, usage: { inputTokens: null, claudeWindows: null }
      });
      if (!verdict.page) continue;
      const trips: NightBreakerTripKind[] = verdict.pause === "production" && verdict.reasons[0]?.startsWith("the same cause twice")
        ? [SAME_CAUSE_TRIP, ...verdict.trips]
        : [...verdict.trips];
      const requestId = `${NIGHT_BREAKER_REQUEST_PREFIX}${read.policy.revision}`;
      const reason = `Night breaker tripped (${trips.join(", ")}): ${verdict.reasons.join("; ")}.`;
      const parked = parks.map((p) => `${p.actionKey} (${p.cause})`).join(", ");
      // The request id comes first so truncation never drops the ping's one-page episode key.
      const message = bounded(`🛑 Production is Off (${requestId}). ${reason} Like an operator Off, this ends a day or standing grant. Parked: ${parked}.`);
      const tripped = writeTransaction(db, () => {
        // #3118 review N1: production may have turned Off (or been granted again) since the read above; trip only while it
        // is still Active at the revision this verdict was read under.
        const current = readProductionPolicySafely(db);
        if (current.status !== "ok" || current.policy.desiredState !== "active" || current.policy.revision !== read.policy.revision) return false;
        db.prepare(
          `INSERT OR IGNORE INTO production_night_breaker_trips (request_id, policy_revision, trips_json, reasons_json, message, tripped_at, ping_id)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`
        ).run(requestId, read.policy.revision, JSON.stringify(trips), JSON.stringify(verdict.reasons), message, now);
        deactivateProduction(db, { requestId, reason, now: input.now });
        return true;
      });
      if (!tripped) break;
      log(message);
      result = { evaluated: true, tripped: true, trips, reasons: verdict.reasons, requestId };
      break;
    }
  }
  deliverTripPings(db, input.now, log);
  return result;
}
