import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { observeCodexTasks } from "../src/codex/observer.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function codexHome(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-codex-observer-"));
  roots.push(root);
  return root;
}

function writeGoals(home: string): void {
  const db = new Database(path.join(home, "goals_1.sqlite"));
  db.exec(`
    CREATE TABLE thread_goals (
      thread_id TEXT PRIMARY KEY,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    INSERT INTO thread_goals VALUES ('thread-1', 'Finish the importer', 'active', 1756000000000);
  `);
  db.close();
}

describe("observeCodexTasks local goals", () => {
  // These files belong to the Codex app, which writes them while Arcadia
  // reads. Every case below is a way that read can fail mid-flight; none of
  // them may reach the caller, because local goals are an optional
  // observability source and selectAgentProfile refuses a launch if this
  // throws.
  const options = { includeCloud: false } as const;

  it("reads a local goal when the goals database is present and there is no state database", () => {
    const home = codexHome();
    writeGoals(home);

    const observed = observeCodexTasks({ ...options, codexHome: home });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ source: "local_goal", sourceTaskId: "thread-1", status: "active" });
    expect(observed[0]?.title).toBe("Finish the importer");
  });

  it("returns no local goals when the Codex home does not exist", () => {
    expect(observeCodexTasks({ ...options, codexHome: path.join(tmpdir(), "arcadia-codex-observer-absent") })).toEqual([]);
  });

  it("still reports goals when the state database exists but cannot be attached", () => {
    // The real failure this reproduces: `existsSync(statePath)` says yes, and
    // the ATTACH then fails because Codex rotated or replaced the file. A
    // directory at that path fails the ATTACH deterministically, the same way.
    const home = codexHome();
    writeGoals(home);
    mkdirSync(path.join(home, "state_5.sqlite"));

    const observed = observeCodexTasks({ ...options, codexHome: home });

    expect(observed).toHaveLength(1);
    expect(observed[0]?.sourceTaskId).toBe("thread-1");
  });

  it("returns no local goals, rather than throwing, when the goals database is not a database", () => {
    const home = codexHome();
    writeGoals(home);
    writeFileSync(path.join(home, "goals_1.sqlite"), "this is not a sqlite file");

    expect(() => observeCodexTasks({ ...options, codexHome: home })).not.toThrow();
    expect(observeCodexTasks({ ...options, codexHome: home })).toEqual([]);
  });

  it("returns no local goals, rather than throwing, when the goals schema is missing its table", () => {
    const home = codexHome();
    const db = new Database(path.join(home, "goals_1.sqlite"));
    db.exec("CREATE TABLE unrelated (id TEXT)");
    db.close();

    expect(() => observeCodexTasks({ ...options, codexHome: home })).not.toThrow();
    expect(observeCodexTasks({ ...options, codexHome: home })).toEqual([]);
  });
});
