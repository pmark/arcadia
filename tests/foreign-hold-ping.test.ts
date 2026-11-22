import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ensureOperatorPingTable } from "../src/ping/operatorPing.js";
import { foreignHoldDedupeKey, FOREIGN_HOLD_PING_AFTER_MS, pingForeignHoldIfPersistent } from "../src/production/tick.js";
import { type ArcadiaError, validationError } from "../src/cli/errors.js";

const hold = (sessionId: string, actionId: string): ArcadiaError =>
  validationError("held", { conflict: true, code: "foreign_resumable_candidate", sessionId, actionId, worktreePath: `/w/${sessionId}` });

function world() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE production_launch_refusal_log (action_key TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL, message TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL)");
  ensureOperatorPingTable(db);
  const setEpisode = (error: ArcadiaError, firstAt: Date) =>
    db.prepare("INSERT INTO production_launch_refusal_log VALUES ('p/a', ?, 'm', ?, ?) ON CONFLICT(action_key) DO UPDATE SET dedupe_key=excluded.dedupe_key, first_at=excluded.first_at, last_at=excluded.last_at")
      .run(foreignHoldDedupeKey(error), firstAt.toISOString(), firstAt.toISOString());
  const pings = () => db.prepare("SELECT message FROM operator_pings").all() as Array<{ message: string }>;
  const ping = (error: ArcadiaError, now: Date) => pingForeignHoldIfPersistent(db, { actionKey: "p/a", error, now, log: () => undefined });
  return { db, setEpisode, pings, ping };
}

describe("foreign resumable candidate hold ping", () => {
  const t0 = new Date("2026-11-22T00:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it("does not ping before the threshold, then pings once per episode however many ticks follow", () => {
    const w = world();
    const a = hold("sess-A", "act-A");
    w.setEpisode(a, t0);
    w.ping(a, at(FOREIGN_HOLD_PING_AFTER_MS - 60_000));
    expect(w.pings()).toHaveLength(0);
    w.ping(a, at(FOREIGN_HOLD_PING_AFTER_MS));
    w.ping(a, at(FOREIGN_HOLD_PING_AFTER_MS + 120_000));
    w.ping(a, at(FOREIGN_HOLD_PING_AFTER_MS + 600_000));
    expect(w.pings()).toHaveLength(1);
    expect(w.pings()[0].message).toContain("sess-A");
  });

  it("treats a different blocking Session as a new episode with its own 15-minute clock and its own ping", () => {
    const w = world();
    const a = hold("sess-A", "act-A");
    const b = hold("sess-B", "act-B");
    w.setEpisode(a, t0);
    w.ping(a, at(FOREIGN_HOLD_PING_AFTER_MS));
    expect(w.pings()).toHaveLength(1);
    const later = at(2 * FOREIGN_HOLD_PING_AFTER_MS);
    w.setEpisode(b, later); // the log restarts first_at because the dedupe key changed
    w.ping(b, new Date(later.getTime() + 60_000));
    expect(w.pings()).toHaveLength(1); // B's grace period has not elapsed
    w.ping(b, new Date(later.getTime() + FOREIGN_HOLD_PING_AFTER_MS));
    w.ping(b, new Date(later.getTime() + FOREIGN_HOLD_PING_AFTER_MS + 60_000));
    const messages = w.pings().map((p) => p.message);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain("sess-B");
  });

  it("ignores a refusal row that belongs to another blocker", () => {
    const w = world();
    const a = hold("sess-A", "act-A");
    w.setEpisode(a, t0);
    w.ping(hold("sess-B", "act-B"), at(FOREIGN_HOLD_PING_AFTER_MS * 2));
    expect(w.pings()).toHaveLength(0);
  });
});
