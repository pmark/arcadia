import { describe, expect, it } from "vitest";
import { applyMigrations } from "../../src/db/schema.js";
import { createSqliteIntelligenceJobRepository } from "../../src/intelligence/db/sqliteRepository.js";
import {
  createTempWorkspace,
  openWorkspaceDatabase,
  removeWorkspace,
} from "./testSupport.js";

describe("intelligence_jobs.capability -> operation_id migration", () => {
  it("renames an existing capability column to operation_id and preserves its data", () => {
    const workspace = createTempWorkspace();
    try {
      const db = openWorkspaceDatabase(workspace);

      // Simulate a database created before the rename: rebuild the column
      // under its old name and insert a row the old way.
      db.exec("ALTER TABLE intelligence_jobs RENAME COLUMN operation_id TO capability");
      db.prepare(
        `INSERT INTO intelligence_jobs (
          id, idempotency_key, capability, client_app, request_json, status,
          retry_count, created_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)`,
      ).run("ijob_legacy", "idem_legacy", "legacy-app.some-workflow.v1", "legacy-app", "{}", "2020-01-01T00:00:00.000Z");

      // Re-running migrations (as every openDatabase() call does) must
      // rename the column back to operation_id without touching its data.
      applyMigrations(db);

      const columns = db.prepare("PRAGMA table_info(intelligence_jobs)").all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === "operation_id")).toBe(true);
      expect(columns.some((column) => column.name === "capability")).toBe(false);

      const row = db
        .prepare("SELECT operation_id FROM intelligence_jobs WHERE id = ?")
        .get("ijob_legacy") as { operation_id: string };
      expect(row.operation_id).toBe("legacy-app.some-workflow.v1");

      const repository = createSqliteIntelligenceJobRepository(db);
      db.close();
      // Re-opening through the normal path must not error or duplicate the migration.
      const reopened = openWorkspaceDatabase(workspace);
      const recheck = createSqliteIntelligenceJobRepository(reopened);
      expect(recheck).toBeTruthy();
      void repository;
      reopened.close();
    } finally {
      removeWorkspace(workspace);
    }
  });
});
