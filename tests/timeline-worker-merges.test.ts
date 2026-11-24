import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { collectProduction } from "../src/timeline/collectors/production.js";
import { runGitReadOnly, type CollectorContext } from "../src/timeline/collectors/context.js";

/** collectProduction against an in-memory workspace database seeded with worker merge rows. */

function context(db: Database.Database): CollectorContext {
  return {
    workspacePath: "/nonexistent",
    db,
    repositories: [],
    projectSlugById: new Map(),
    operatorEmails: new Set(),
    window: { since: new Date("2026-11-24T00:00:00Z"), until: new Date("2026-11-25T00:00:00Z") },
    maxPerSource: 100,
    now: new Date("2026-11-25T00:00:00Z"),
    git: runGitReadOnly,
    includePullRequests: false,
    gh: () => ({ ok: false, stdout: "", stderr: "" })
  };
}

function seed(db: Database.Database): void {
  db.exec(`CREATE TABLE production_worker_merges (
    request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, action_key TEXT NOT NULL, pull_request_url TEXT,
    head TEXT NOT NULL, outcome TEXT NOT NULL, code TEXT, reason TEXT NOT NULL, boundaries_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
  )`);
  const insert = db.prepare("INSERT INTO production_worker_merges (request_id, session_id, action_key, pull_request_url, head, outcome, code, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'r', ?)");
  insert.run("req-merged", "sess-1", "arcadia/alpha", "https://github.com/pmark/arcadia/pull/3001", "a".repeat(40), "merged", null, "2026-11-24T10:00:00.000Z");
  insert.run("req-refused", "sess-2", "arcadia/beta", "https://github.com/pmark/arcadia/pull/3002", "b".repeat(40), "refused", "base_not_synced", "2026-11-24T11:00:00.000Z");
  insert.run("req-old", "sess-3", "arcadia/gamma", "https://github.com/pmark/arcadia/pull/2999", "c".repeat(40), "merged", null, "2026-11-20T10:00:00.000Z");
}

describe("timeline worker merges", () => {
  it("emits one production.worker_merge event per row inside the window", () => {
    const db = new Database(":memory:");
    seed(db);
    const events = collectProduction(context(db)).filter((event) => event.kind === "production.worker_merge");
    expect(events).toHaveLength(2);
    const merged = events.find((event) => event.id.endsWith("req-merged"));
    expect(merged?.subjects).toMatchObject({ project: "arcadia", action: "alpha", pullRequest: "#3001" });
    expect(merged?.summary).toContain("merged");
    expect(merged?.evidence).toEqual([{ kind: "row", value: "production_worker_merges/req-merged" }]);
    expect(merged?.actor.tool).toBe("host-worker");
    const refused = events.find((event) => event.id.endsWith("req-refused"));
    expect(refused?.subjects).toMatchObject({ action: "beta", pullRequest: "#3002" });
    expect(refused?.summary).toContain("refused");
    expect(refused?.summary).toContain("base_not_synced");
    expect(events.some((event) => event.id.endsWith("req-old"))).toBe(false);
  });

  it("yields no event and no error when the table is absent", () => {
    const db = new Database(":memory:");
    expect(collectProduction(context(db)).filter((event) => event.kind === "production.worker_merge")).toEqual([]);
  });
});
