import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeTransaction } from "../src/db/connection.js";

/**
 * Reproduces `docs/self-blocking-guards.md` item 5: settlement writes failing
 * with "database is locked" while long-running services hold the workspace
 * database open. The failure is `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout`
 * cannot resolve and retrying the command cannot escape.
 */
describe("writeTransaction", () => {
  let dir: string;
  let file: string;
  let writer: Database.Database;
  let service: Database.Database;

  function open(): Database.Database {
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 200");
    return db;
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "arcadia-wal-"));
    file = path.join(dir, "test.sqlite3");
    const setup = open();
    setup.exec("CREATE TABLE receipts (id INTEGER PRIMARY KEY, note TEXT)");
    setup.close();
    writer = open();
    service = open();
  });

  afterEach(() => {
    writer.close();
    service.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("survives another connection committing between its read and its write", () => {
    let interleaved = false;

    const result = writeTransaction(writer, () => {
      // The read a settlement does before it writes -- loading documents,
      // rebuilding the queue -- is what establishes the snapshot.
      writer.prepare("SELECT count(*) AS n FROM receipts").get();
      if (!interleaved) {
        interleaved = true;
        // A service commits while the settlement is still reading. Under
        // BEGIN IMMEDIATE the write lock is already held, so this is the
        // second writer and it is the one refused.
        expect(() => service.prepare("INSERT INTO receipts (note) VALUES ('service')").run())
          .toThrowError(/database is locked/);
      }
      writer.prepare("INSERT INTO receipts (note) VALUES ('settlement')").run();
      return "settled";
    });

    expect(result).toBe("settled");
    expect(interleaved).toBe(true);
    expect(writer.prepare("SELECT note FROM receipts").all()).toEqual([{ note: "settlement" }]);
  });

  it("is the fix for a deferred transaction, which fails outright in the same sequence", () => {
    const deferred = writer.transaction(() => {
      writer.prepare("SELECT count(*) AS n FROM receipts").get();
      // A deferred BEGIN has only taken a read snapshot, so the service's
      // commit succeeds and invalidates it.
      service.prepare("INSERT INTO receipts (note) VALUES ('service')").run();
      writer.prepare("INSERT INTO receipts (note) VALUES ('settlement')").run();
    });

    expect(() => deferred()).toThrowError(/database is locked/);
    // The settlement wrote nothing; only the service's row survives. Waiting
    // longer would not have helped, which is why the command could only be
    // retried after a service was stopped.
    expect(writer.prepare("SELECT note FROM receipts").all()).toEqual([{ note: "service" }]);
  });
});
