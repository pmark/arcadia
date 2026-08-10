import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyInitialSchema, applyMigrations, readInitialSchema } from "../src/db/schema.js";

describe("narrative_digests scope migration", () => {
  it("rebuilds a legacy Project-only table without losing rows or the index", () => {
    const db = new Database(":memory:");
    db.exec(readInitialSchema());
    // The pre-scheduling shape, exactly as it shipped.
    db.exec(`
      CREATE TABLE narrative_digests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        period TEXT NOT NULL CHECK (period IN ('day', 'week', 'month')),
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        intelligence_job_id TEXT,
        facts_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, period, window_start, window_end),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_narrative_digests_project_window
        ON narrative_digests(project_id, window_start, window_end);
    `);
    db.prepare("INSERT INTO projects (id, name, slug, mission, status, created_at, updated_at) VALUES ('p1','Alpha','alpha','m','active','t','t')").run();
    db.prepare("INSERT INTO artifacts (id, project_id, title, artifact_type, status, path, created_at, updated_at) VALUES ('a1','p1','t','narrative_digest','ready','x.md','t','t')").run();
    db.prepare(`INSERT INTO narrative_digests (id, project_id, artifact_id, period, window_start, window_end, facts_json, created_at, updated_at)
      VALUES ('d1','p1','a1','day','s','e','[]','t','t')`).run();

    applyMigrations(db);

    const row = db.prepare("SELECT * FROM narrative_digests WHERE id = 'd1'").get() as any;
    expect(row.scope).toBe("project");
    expect(row.scope_key).toBe("p1");
    expect(row.project_id).toBe("p1");
    expect(row.posted_message_id).toBeNull();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_narrative_digests_project_window'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='narrative_digests_legacy'").get()).toBeUndefined();

    // A portfolio row now fits, and stays unique per window despite NULL project_id.
    db.prepare(`INSERT INTO narrative_digests (id, scope, scope_key, project_id, artifact_id, period, window_start, window_end, facts_json, created_at, updated_at)
      VALUES ('d2','portfolio','portfolio',NULL,'a1','day','s','e','[]','t','t')`).run();
    expect(() => db.prepare(`INSERT INTO narrative_digests (id, scope, scope_key, project_id, artifact_id, period, window_start, window_end, facts_json, created_at, updated_at)
      VALUES ('d3','portfolio','portfolio',NULL,'a1','day','s','e','[]','t','t')`).run()).toThrow(/UNIQUE/);

    // Re-running is a no-op.
    applyMigrations(db);
    expect(db.prepare("SELECT COUNT(*) AS c FROM narrative_digests").get()).toEqual({ c: 2 });
    db.close();
  });

  it("creates the scoped shape directly on a fresh database", () => {
    const db = new Database(":memory:");
    applyInitialSchema(db);
    const columns = (db.prepare("PRAGMA table_info(narrative_digests)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["scope", "scope_key", "posted_message_id", "posted_at"]));
    db.close();
  });
});
