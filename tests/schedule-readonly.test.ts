import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScheduleLogCommand, runScheduleStatusCommand } from "../src/commands/schedule.js";
import { openReadOnlyDatabase, withDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import {
  getSchedulingAction,
  getSchedulingProject,
  listSchedulingActions,
  replaySchedulingResult
} from "../src/scheduling/store.js";
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
    expect(response.data.schedule.projects[0].record.priority).toBe(1000);
  });

  it("schedule log succeeds with an empty result instead of failing to write a readonly database", () => {
    const root = workspaceMissingSchedulingTables();
    const response = runScheduleLogCommand({ workspace: root });
    expect(response.data.entries).toEqual([]);
  });

  it("falls back to empty/null for scheduling_actions and scheduling_log reads directly, not just through the command", () => {
    const root = workspaceMissingSchedulingTables();
    const db = openReadOnlyDatabase(root);
    try {
      expect(getSchedulingAction(db, "readonly-test-project/some-action")).toBeNull();
      expect(listSchedulingActions(db, "readonly-test-project")).toEqual([]);
      expect(replaySchedulingResult(db, "some-request-id")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("normalizes a pre-migration scheduling_projects row instead of returning undefined for later columns", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-schedule-readonly-"));
    temporary.push(root);
    initWorkspace(root);
    withDatabase(root, (db) => {
      // Recreate the table as it looked before paused_decision_id,
      // github_status_field_id, github_status_options_json,
      // last_reconciled_at, and projection_in_flight were added.
      db.exec(`
        DROP TABLE scheduling_projects;
        CREATE TABLE scheduling_projects (
          project_slug TEXT PRIMARY KEY,
          priority INTEGER NOT NULL DEFAULT 1000,
          github_owner TEXT,
          github_project_number INTEGER,
          github_project_id TEXT,
          github_repository TEXT,
          last_projected_revision INTEGER NOT NULL DEFAULT -1,
          last_projected_order_json TEXT NOT NULL DEFAULT '[]',
          failed_runs INTEGER NOT NULL DEFAULT 0,
          failed_runs_milestone TEXT,
          paused_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare(
        `INSERT INTO scheduling_projects (project_slug, priority, last_projected_order_json, created_at, updated_at)
         VALUES ('pre-migration-project', 500, '[]', '2020-01-01', '2020-01-01')`
      ).run();
    });

    const db = openReadOnlyDatabase(root);
    try {
      const record = getSchedulingProject(db, "pre-migration-project");
      expect(record.priority).toBe(500);
      expect(record.pausedDecisionId).toBeNull();
      expect(record.githubStatusFieldId).toBeNull();
      expect(record.githubStatusOptions).toBeNull();
      expect(record.lastReconciledAt).toBeNull();
      expect(record.projectionInFlight).toBe(false);
    } finally {
      db.close();
    }
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
