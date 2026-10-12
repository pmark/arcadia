import { describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { retryOnSqliteLock } from "../src/db/connection.js";

function busy(): Error {
  return Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
}

describe("retryOnSqliteLock", () => {
  it("retries a transient lock with growing backoff and then succeeds", () => {
    const delays: number[] = [];
    let failures = 2;
    const result = retryOnSqliteLock(() => {
      if (failures-- > 0) throw busy();
      return "synced";
    }, { sleep: (ms) => delays.push(ms), baseDelayMs: 10 });
    expect(result).toBe("synced");
    expect(delays).toEqual([10, 20]);
  });

  it("surfaces a named error once the bound is exhausted", () => {
    let calls = 0;
    const delays: number[] = [];
    let thrown: unknown;
    try {
      retryOnSqliteLock(() => { calls += 1; throw busy(); }, { attempts: 3, sleep: (ms) => delays.push(ms), baseDelayMs: 5 });
    } catch (error) {
      thrown = error;
    }
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);
    expect(thrown).toBeInstanceOf(ArcadiaError);
    expect(thrown).toMatchObject({ code: "SQLITE_LOCK_RETRIES_EXHAUSTED", details: { attempts: 3, cause: "database is locked" } });
  });

  it("does not retry an error that is not a lock", () => {
    let calls = 0;
    expect(() => retryOnSqliteLock(() => { calls += 1; throw new Error("no such table"); }, { sleep: () => undefined }))
      .toThrow("no such table");
    expect(calls).toBe(1);
  });
});
