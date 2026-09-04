import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyInitialSchema, applyMigrations } from "../src/db/schema.js";

describe("work_items responsibility rename migration", () => {
  it("rewrites a legacy 'codex' work_classification to 'agent' without losing rows", () => {
    const db = new Database(":memory:");
    applyInitialSchema(db);

    // Reconstruct the exact pre-rename table shape: same columns as today,
    // but the CHECK constraint still names the retired "codex" value.
    const currentSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'work_items'").get() as {
        sql: string;
      }
    ).sql;
    const legacySql = currentSql.replace(
      "work_classification TEXT NOT NULL CHECK (work_classification IN ('autonomous', 'agent', 'requires_review', 'blocked'))",
      "work_classification TEXT NOT NULL CHECK (work_classification IN ('autonomous', 'codex', 'requires_review', 'blocked'))"
    );
    expect(legacySql).not.toBe(currentSql);

    const columns = (db.prepare("PRAGMA table_info(work_items)").all() as Array<{ name: string }>).map(
      (column) => column.name
    );
    const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
    db.exec(`
      ALTER TABLE work_items RENAME TO work_items_new_shape;
      ${legacySql.replace("CREATE TABLE IF NOT EXISTS work_items", "CREATE TABLE work_items")}
    `);
    db.prepare(
      `INSERT INTO work_items (${quotedColumns}) SELECT ${quotedColumns} FROM work_items_new_shape`
    ).run();
    db.exec("DROP TABLE work_items_new_shape");

    db.prepare(
      `INSERT INTO work_items (id, title, raw_input, queue, work_classification, next_action, status, created_at, updated_at)
       VALUES ('w1', 'Legacy item', 'Legacy item', 'work_queue', 'codex', 'Do the thing', 'open', 't', 't')`
    ).run();

    applyMigrations(db);

    const row = db.prepare("SELECT work_classification FROM work_items WHERE id = 'w1'").get() as {
      work_classification: string;
    };
    expect(row.work_classification).toBe("agent");

    // A fresh row using the new value is accepted by the rebuilt CHECK constraint.
    db.prepare(
      `INSERT INTO work_items (id, title, raw_input, queue, work_classification, next_action, status, created_at, updated_at)
       VALUES ('w2', 'New item', 'New item', 'work_queue', 'agent', 'Do the other thing', 'open', 't', 't')`
    ).run();
    expect(db.prepare("SELECT COUNT(*) AS c FROM work_items").get()).toEqual({ c: 2 });

    // Re-running is a no-op.
    applyMigrations(db);
    expect(db.prepare("SELECT COUNT(*) AS c FROM work_items").get()).toEqual({ c: 2 });
    db.close();
  });

  it("creates the current CHECK constraint directly on a fresh database", () => {
    const db = new Database(":memory:");
    applyInitialSchema(db);

    expect(() =>
      db
        .prepare(
          `INSERT INTO work_items (id, title, raw_input, queue, work_classification, next_action, status, created_at, updated_at)
           VALUES ('w1', 'Item', 'Item', 'work_queue', 'codex', 'Do the thing', 'open', 't', 't')`
        )
        .run()
    ).toThrow(/CHECK constraint failed/);

    db.prepare(
      `INSERT INTO work_items (id, title, raw_input, queue, work_classification, next_action, status, created_at, updated_at)
       VALUES ('w2', 'Item', 'Item', 'work_queue', 'agent', 'Do the thing', 'open', 't', 't')`
    ).run();
    expect(db.prepare("SELECT COUNT(*) AS c FROM work_items").get()).toEqual({ c: 1 });
    db.close();
  });
});
