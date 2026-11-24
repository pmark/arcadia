import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { collectAsks } from "../src/timeline/collectors/asks.js";
import { runGitReadOnly, type CollectorContext } from "../src/timeline/collectors/context.js";

/** collectAsks against an in-memory workspace database seeded with Ask supersessions. */

function context(db: Database.Database): CollectorContext {
  return {
    workspacePath: "/nonexistent",
    db,
    repositories: [],
    projectSlugById: new Map([["proj_arcadia", "arcadia"]]),
    operatorEmails: new Set(),
    window: { since: new Date("2026-11-24T00:00:00Z"), until: new Date("2026-11-25T00:00:00Z") },
    maxPerSource: 100,
    now: new Date("2026-11-25T00:00:00Z"),
    git: runGitReadOnly,
    includePullRequests: false,
    gh: () => ({ ok: false, stdout: "", stderr: "" })
  };
}

function seedSupersessions(db: Database.Database): void {
  db.exec(`CREATE TABLE ask_supersessions (
    id TEXT PRIMARY KEY, old_ask_request_id TEXT NOT NULL, new_ask_request_id TEXT NOT NULL, target_type TEXT NOT NULL,
    project_id TEXT, old_kind TEXT NOT NULL, old_record_id TEXT, new_kind TEXT NOT NULL, new_record_id TEXT,
    old_disposition TEXT NOT NULL, source TEXT NOT NULL, actor TEXT, created_at TEXT NOT NULL
  )`);
  const insert = db.prepare(
    "INSERT INTO ask_supersessions (id, old_ask_request_id, new_ask_request_id, target_type, project_id, old_kind, old_record_id, new_kind, new_record_id, old_disposition, source, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run("sup_in", "ask-old", "ask-new", "proposal", "proj_arcadia", "proposal", "p1", "proposal", "p2", "withdrawn", "ask correct", null, "2026-11-24T10:00:00.000Z");
  insert.run("sup_old", "ask-a", "ask-b", "proposal", "proj_arcadia", "proposal", "p3", "proposal", "p4", "withdrawn", "ask correct", null, "2026-11-20T10:00:00.000Z");
}

describe("timeline ask supersessions", () => {
  it("emits one ask.superseded event inside the window naming both request ids and the replaced kind", () => {
    const db = new Database(":memory:");
    seedSupersessions(db);
    const events = collectAsks(context(db));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "asks:supersession:sup_in",
      source: "asks",
      kind: "ask.superseded",
      workKind: "govern",
      time: "2026-11-24T10:00:00.000Z",
      subjects: { project: "arcadia", ask: "ask-new" },
      evidence: [{ kind: "row", value: "ask_supersessions/sup_in" }]
    });
    expect(events[0]?.summary).toContain("ask-old");
    expect(events[0]?.summary).toContain("ask-new");
    expect(events[0]?.summary).toContain("proposal");
  });

  it("yields no event and no error when the database has no ask_supersessions table", () => {
    expect(collectAsks(context(new Database(":memory:")))).toEqual([]);
  });

  it("leaves proposal events unchanged beside a supersession", () => {
    const db = new Database(":memory:");
    seedSupersessions(db);
    db.exec("CREATE TABLE agent_ask_proposals (id TEXT PRIMARY KEY, request_id TEXT, intent_kind TEXT, project_ref TEXT, created_at TEXT)");
    db.prepare("INSERT INTO agent_ask_proposals VALUES (?, ?, ?, ?, ?)").run("prop_1", "ask-new", "proposal", "arcadia", "2026-11-24T09:00:00.000Z");
    const events = collectAsks(context(db));
    expect(events.map((event) => event.kind).sort()).toEqual(["ask.proposed", "ask.superseded"]);
    expect(events.find((event) => event.kind === "ask.proposed")?.summary).toBe("Ask ask-new previewed (proposal)");
  });
});
