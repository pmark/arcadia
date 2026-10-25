import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorktreeReservationInventory, runWorkReservationsCommand } from "../src/commands/workReservations.js";
import { withDatabase } from "../src/db/connection.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const now = new Date("2026-10-25T18:00:00.000Z");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE agent_worktree_reservations (
    id TEXT, repository_path TEXT, worktree_path TEXT, branch TEXT, created_at TEXT, expires_at TEXT,
    project TEXT, action_id TEXT, claim_generation TEXT
  )`);
  return db;
}
function insert(db: Database.Database, id: string, expires = "2026-10-26T18:00:00.000Z") {
  db.prepare("INSERT INTO agent_worktree_reservations VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)")
    .run(id, `/unregistered/${id}`, `/missing/${id}`, "agent/work", "2026-10-25T17:00:00.000Z", expires, "private-claim-fence");
}

describe("read-only handoff reservation inventory", () => {
  it("includes every unexpired reservation without Project, liveness or history filtering", () => {
    const db = fixture();
    try {
      for (let i = 0; i < 301; i++) insert(db, `r${i}`);
      insert(db, "expired", "2026-10-25T17:59:59.999Z");
      insert(db, "boundary", now.toISOString());
      const before = db.prepare("SELECT * FROM agent_worktree_reservations ORDER BY id").all();
      db.pragma("query_only = ON");
      const result = readWorktreeReservationInventory(db, now);
      expect(result.reservations).toHaveLength(301);
      expect(result.coverage).toBe("workspace-wide");
      expect(result.observedAt).toBe(now.toISOString());
      expect(JSON.stringify(result)).not.toContain("private-claim-fence");
      expect(db.prepare("SELECT * FROM agent_worktree_reservations ORDER BY id").all()).toEqual(before);
    } finally { db.close(); }
  });
  it("distinguishes a known empty inventory from unavailable schema", () => {
    const db = fixture();
    try {
      expect(readWorktreeReservationInventory(db, now).reservations).toEqual([]);
      db.exec("DROP TABLE agent_worktree_reservations");
      expect(() => readWorktreeReservationInventory(db, now)).toThrow(/schema is missing/);
      expect(db.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
    } finally { db.close(); }
  });
  it.each(["not-a-date", "2026-10-25", "9999", null])("refuses invalid expiry %s even on a row a string filter could hide", expires => {
    const db = fixture();
    try {
      insert(db, "bad");
      db.prepare("UPDATE agent_worktree_reservations SET expires_at = ?").run(expires);
      expect(() => readWorktreeReservationInventory(db, now)).toThrow(/invalid reservation timestamp/);
    } finally { db.close(); }
  });
  it("refuses incomplete identity and legacy schema rather than reporting complete coverage", () => {
    const db = fixture();
    try {
      insert(db, "bad");
      db.exec("UPDATE agent_worktree_reservations SET worktree_path = NULL");
      expect(() => readWorktreeReservationInventory(db, now)).toThrow(/invalid reservation identity/);
      db.exec("ALTER TABLE agent_worktree_reservations DROP COLUMN action_id");
      expect(() => readWorktreeReservationInventory(db, now)).toThrow(/schema is missing/);
    } finally { db.close(); }
  });
  it("the supported command reads a file database without changing its bytes or recovering journals", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-reservation-inventory-")); roots.push(root);
    const workspace = path.join(root, "workspace");
    initWorkspace(workspace);
    withDatabase(workspace, db => {
      db.prepare(`INSERT INTO agent_worktree_reservations
        (id, repository_path, worktree_path, branch, created_at, expires_at)
        VALUES ('held', '/unregistered', '/absent', 'agent/held', ?, ?)`)
        .run(now.toISOString(), "2999-01-01T00:00:00.000Z");
      db.pragma("wal_checkpoint(TRUNCATE)");
    });
    const file = getWorkspacePaths(workspace).databaseFile;
    const before = readFileSync(file);
    const result = runWorkReservationsCommand({ workspace });
    expect(result.data.reservations.map(row => row.id)).toEqual(["held"]);
    expect(readFileSync(file)).toEqual(before);
  });
});
