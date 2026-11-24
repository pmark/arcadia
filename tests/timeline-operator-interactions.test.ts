import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { collectOperatorInteractions, operatorInteractionsCollector } from "../src/timeline/collectors/operatorInteractions.js";
import { runGitReadOnly, type CollectorContext } from "../src/timeline/collectors/context.js";
import { defaultCollectors } from "../src/timeline/index.js";

/** collectOperatorInteractions against an in-memory workspace database seeded with recorded interactions. */

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
  db.exec(`CREATE TABLE operator_interactions (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, words TEXT NOT NULL, unlocked TEXT NOT NULL, necessity TEXT NOT NULL,
    ref TEXT, project TEXT, waiting_since TEXT, recorded_by TEXT, created_at TEXT NOT NULL
  )`);
  const insert = db.prepare(
    "INSERT INTO operator_interactions (id, at, words, unlocked, necessity, ref, project, waiting_since, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run("opint_req", "2026-11-24T10:00:00.000Z", "Yes merge them", "merge of PR 3001", "required", "PR 3001", "arcadia", "2026-11-24T09:30:00.000Z", "Claudia Mason", "2026-11-24T10:01:00.000Z");
  insert.run("opint_avoid", "2026-11-24T11:00:00.000Z", "x".repeat(500), "a restart", "avoidable", null, "arcadia", null, null, "2026-11-24T11:01:00.000Z");
  insert.run("opint_old", "2026-11-20T10:00:00.000Z", "old words", "old unlock", "required", null, "arcadia", null, null, "2026-11-20T10:01:00.000Z");
  insert.run("opint_edge", "2026-11-25T00:00:00.000Z", "edge words", "edge unlock", "required", null, "arcadia", null, null, "2026-11-25T00:01:00.000Z");
}

describe("timeline operator interactions", () => {
  it("emits one event per row inside the window, with the operator as actor and the row as evidence", () => {
    const db = new Database(":memory:");
    seed(db);
    const events = collectOperatorInteractions(context(db));
    expect(events.map((event) => event.id).sort()).toEqual(["operator-interactions:opint_avoid", "operator-interactions:opint_req"]);
    const required = events.find((event) => event.id.endsWith("opint_req"));
    expect(required).toMatchObject({
      source: "operator-interactions",
      kind: "operator.interaction",
      workKind: "govern",
      time: "2026-11-24T10:00:00.000Z",
      attention: false,
      subjects: { project: "arcadia" },
      actor: { tool: "operator" },
      evidence: [{ kind: "row", value: "operator_interactions/opint_req" }]
    });
    expect(required?.summary).toContain("merge of PR 3001");
    expect(required?.summary).toContain("required");
    expect(required?.provenance.words).toBe("Yes merge them");
    expect(required?.provenance.waited).toContain("30 min");
  });

  it("names avoidable interactions, caps the words at 200 characters and omits waiting when unset", () => {
    const db = new Database(":memory:");
    seed(db);
    const avoidable = collectOperatorInteractions(context(db)).find((event) => event.id.endsWith("opint_avoid"));
    expect(avoidable?.summary).toContain("avoidable");
    expect(avoidable?.provenance.words).toHaveLength(200);
    expect(avoidable?.provenance.waited).toBeUndefined();
  });

  it("yields no event and no error when the database has no operator_interactions table", () => {
    expect(collectOperatorInteractions(context(new Database(":memory:")))).toEqual([]);
  });

  it("is registered in defaultCollectors", () => {
    expect(defaultCollectors([])).toContain(operatorInteractionsCollector);
  });
});
