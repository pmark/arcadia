import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScheduleLogCommand, runScheduleStatusCommand } from "../src/commands/schedule.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/**
 * Stands in for a workspace created before the scheduling tables shipped
 * (#313): everything else is migrated, but `scheduling_*` does not exist yet.
 */
function workspaceMissingSchedulingTables(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-schedule-readonly-"));
  temporary.push(root);
  initWorkspace(root);
  withDatabase(root, (db) => {
    upsertProject(db, { name: "Readonly Test Project", mission: "Prove the read path.", status: "active" });
    db.exec("DROP TABLE scheduling_projects; DROP TABLE scheduling_actions; DROP TABLE scheduling_log;");
  });
  return root;
}

describe("schedule status/log on a workspace without the scheduling tables", () => {
  it("schedule status succeeds instead of failing to write a readonly database", () => {
    const root = workspaceMissingSchedulingTables();
    const response = runScheduleStatusCommand({ workspace: root });
    expect(response.data.schedule.projects).toHaveLength(1);
    expect(response.data.schedule.projects[0]!.record.priority).toBe(1000);
  });

  it("schedule log succeeds with an empty result instead of failing to write a readonly database", () => {
    const root = workspaceMissingSchedulingTables();
    const response = runScheduleLogCommand({ workspace: root });
    expect(response.data.entries).toEqual([]);
  });

  it("a later writable open still creates the tables normally", () => {
    const root = workspaceMissingSchedulingTables();
    runScheduleStatusCommand({ workspace: root });
    withDatabase(root, (db) => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'scheduling_%'")
        .all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name).sort()).toEqual(["scheduling_actions", "scheduling_log", "scheduling_projects"]);
    });
  });
});
