import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { deriveJourneyProgress } from "../src/journey/progress.js";

const now = new Date("2026-10-25T12:00:00Z");
function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE agent_sessions(id TEXT, project_slug TEXT, plan_slug TEXT, action_id TEXT, is_simulated INTEGER, started_at TEXT, ended_at TEXT, provider TEXT DEFAULT 'test-cli', model TEXT DEFAULT 'configured-model', effort TEXT DEFAULT 'high', prepared_at TEXT DEFAULT '2026-10-24T10:00:00Z');
    CREATE TABLE production_worker_merges(session_id TEXT, action_key TEXT, head TEXT, pull_request_url TEXT, updated_at TEXT, outcome TEXT);
    CREATE TABLE production_red_alerts(id TEXT, action_key TEXT, session_id TEXT, cleared_at TEXT, status TEXT);
    CREATE TABLE session_exit_receipts(session_id TEXT, outcome TEXT, created_at TEXT);`);
  return db;
}
describe("Journey period evidence", () => {
  it("deduplicates delivered heads, excludes simulation, wrong Plan and false acceptance, and respects half-open boundaries", () => {
    const db = fixture();
    db.exec(`INSERT INTO agent_sessions(id, project_slug, plan_slug, action_id, is_simulated, started_at, ended_at) VALUES ('real','p','plan','a',0,NULL,NULL), ('sim','p','plan','a',1,NULL,NULL), ('other','p','other','a',0,NULL,NULL);
      INSERT INTO production_worker_merges VALUES
      ('real','p/a','head',NULL,'2026-10-24T12:00:00Z','merged'),
      ('real','p/a','head',NULL,'2026-10-24T13:00:00Z','merged'),
      ('real','p/a','later',NULL,'2026-10-25T12:00:00Z','merged'),
      ('sim','p/a','simulated',NULL,'2026-10-24T13:00:00Z','merged'),
      ('other','p/a','wrongplan',NULL,'2026-10-24T13:00:00Z','merged'),
      ('real','p/wrong','wrongaction',NULL,'2026-10-24T13:00:00Z','merged');
      INSERT INTO session_exit_receipts VALUES ('real','accepted_completion','2026-10-24T13:00:00Z');`);
    const result = deriveJourneyProgress(db,'p','plan',['a'],now);
    expect(result.periods[0].current.delivered).toBe(1);
    expect(result.periods[0].current.deliveredPerDay).toBe(1);
    expect(result.periods[0].current.failed).toBe(0);
    expect(result.periods[0].current.sessionHours).toBeNull();
    expect(result.periods[0].current.evidence[0].source).toBe('production_worker_merges');
    db.close();
  });
  it("counts clears at clearance time, unique interrupted Sessions, and clips/sums/unions closed spans", () => {
    const db = fixture();
    db.exec(`INSERT INTO agent_sessions(id, project_slug, plan_slug, action_id, is_simulated, started_at, ended_at) VALUES
      ('one','p','plan','a',0,'2026-10-24T10:00:00Z','2026-10-24T14:00:00Z'),
      ('two','p','plan','a',0,'2026-10-24T13:00:00Z','2026-10-24T15:00:00Z'),
      ('open','p','plan','a',0,'2026-10-24T13:00:00Z',NULL);
      INSERT INTO production_red_alerts VALUES ('rock','p/a','one','2026-10-24T14:30:00Z','cleared'), ('reopened','p/a','one',NULL,'open'), ('unbound','p/a',NULL,'2026-10-24T14:30:00Z','cleared');
      INSERT INTO session_exit_receipts VALUES ('one','interrupted','2026-10-24T14:00:00Z'), ('one','interrupted','2026-10-24T14:00:00Z'), ('two','failed','2026-10-23T14:00:00Z');`);
    const result = deriveJourneyProgress(db,'p','plan',['a'],now);
    const { current, previous } = result.periods[0];
    expect(current.services[0]).toMatchObject({ service: 'test-cli', configuredModel: 'configured-model', configuredEffort: 'high', runtimeModel: null, runtimeEffort: null, sessions: 3, closedSpans: 2, sessionHours: 4, delivered: 0, failed: 1 });
    expect(current.services[0].sessionIds).toEqual(['one','two','open']);
    expect(current.cleared).toBe(1);
    expect(current.failed).toBe(1);
    expect(previous.failed).toBe(1);
    expect(current.sessionHours).toBe(4);
    expect(current.occupiedHours).toBe(3);
    expect(previous.sessionHours).toBe(2);
    expect(current.sessionsWithoutBounds).toBe(1);
    expect(result.periods[1].current.elapsedDays).toBe(7);
    expect(result.periods[1].current.clearedPerDay).toBe(1/7);
    db.close();
  });
  it("keeps unknown coverage and effort visible when optional tables are absent", () => {
    const db = new Database(":memory:");
    const result = deriveJourneyProgress(db,'p','plan',['a'],now);
    expect(result.periods.map(p => p.days)).toEqual([1,7,30]);
    expect(result.periods[0].current.sessionHours).toBeNull();
    expect(result.limitations.join(' ')).toContain('Reopening counts are unknown');
    db.close();
  });
});
