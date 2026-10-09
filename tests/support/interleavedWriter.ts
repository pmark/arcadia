import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/connection.js";

/**
 * Reproduces the `SQLITE_BUSY_SNAPSHOT` race that #1102/#1104/#1106 fixed:
 * another connection commits after a transaction's first read and before its
 * first write.
 *
 * `wrap(db)` returns a Proxy of the connection under test. The first `SELECT`
 * statement that completes while `db.inTransaction` is true triggers one
 * competing write on a second connection whose `busy_timeout` is 0.
 *
 * - On a deferred transaction that read has only taken a snapshot, so the
 *   competing write commits (`landed`) and the transaction's own write then
 *   fails with "database is locked".
 * - On an IMMEDIATE transaction the write lock is already held, so the
 *   competing write is refused (`refused`) and the transaction proceeds.
 *
 * With `options.transaction = n` only the nth `db.transaction()` call (counted
 * across every connection wrapped by this writer) and what follows it arms the
 * interleave.
 *
 * Tests assert `outcome() === "refused"`: that proves both that the interleave
 * happened inside the transaction and that the lock was held at the read.
 */
export function createInterleavedWriter(
  workspace: string,
  /** Arm on the nth `db.transaction()` call, for commands that open several. */
  options: { transaction?: number } = {}
): {
  wrap: (db: Database.Database) => Database.Database;
  outcome: () => "none" | "refused" | "landed";
  close: () => void;
} {
  const competing = openDatabase(workspace);
  competing.pragma("busy_timeout = 0");
  competing.exec("CREATE TABLE IF NOT EXISTS interleave_probe (id INTEGER PRIMARY KEY, note TEXT)");
  let result: "none" | "refused" | "landed" = "none";
  const armOn = options.transaction ?? 1;
  let transactions = 0;

  function interleave(): void {
    if (result !== "none" || transactions < armOn) return;
    try {
      competing.exec("INSERT INTO interleave_probe (note) VALUES ('competing writer')");
      result = "landed";
    } catch (error) {
      if (!/database is locked|SQLITE_BUSY/i.test(String(error))) throw error;
      result = "refused";
    }
  }

  return {
    wrap(db) {
      return new Proxy(db, {
        get(target, property) {
          if (property === "transaction") {
            return (...args: Parameters<Database.Database["transaction"]>) => {
              transactions += 1;
              return target.transaction(...args);
            };
          }
          if (property === "prepare") {
            return (sql: string) => {
              const statement = target.prepare(sql);
              if (!/^\s*(select|with)/i.test(sql)) return statement;
              return new Proxy(statement, {
                get(inner, method) {
                  const value = Reflect.get(inner, method);
                  if (typeof value !== "function") return value;
                  return (...args: unknown[]) => {
                    const out = value.apply(inner, args);
                    if (target.inTransaction) interleave();
                    return out;
                  };
                }
              });
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    },
    outcome: () => result,
    close: () => competing.close()
  };
}
