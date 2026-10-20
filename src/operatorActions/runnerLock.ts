import Database from "better-sqlite3";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { refuse } from "./planAmendmentContract.js";

/**
 * Claim a shared runner's per-action lock file, or refuse with ALREADY_RUNNING.
 * A lock whose owner process is gone is reclaimed. Returns only once this
 * process owns the lock; the caller removes it when it finishes.
 */
export function claimRunnerLock(lock: string, noun = "amendment"): void {
  mkdirSync(path.dirname(lock), { recursive: true });
  try { writeFileSync(lock, String(process.pid), { flag: "wx" }); return; }
  catch { /* Held, or held by a stale owner: decide below under the interlock. */ }
  // All stale reapers share this local SQLite write interlock. Normal wx
  // claimants may win the unlink/create interval, but can never be removed
  // by a second stale reaper. This file stores no governance or work state.
  const reclamation = new Database(path.join(path.dirname(lock), "lock-reclamation.sqlite3"));
  try {
    reclamation.pragma("busy_timeout = 5000");
    reclamation.transaction(() => {
      let observed: string;
      try { observed = readFileSync(lock, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try { writeFileSync(lock, String(process.pid), { flag: "wx" }); return; }
        catch { refuse("ALREADY_RUNNING", `Another invocation claimed the ${noun}.`, "Wait for that exact invocation to finish."); }
      }
      const owner = Number(observed);
      if (!Number.isSafeInteger(owner) || owner < 1) refuse("ALREADY_RUNNING", `The ${noun} lock has no valid owner.`, "Preserve the lock and receipt; repair the invalid host lock before retrying.");
      try { process.kill(owner, 0); refuse("ALREADY_RUNNING", `This ${noun} is already running.`, "Wait for the current invocation to finish; it owns the exact proposal."); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        if (readFileSync(lock, "utf8") !== observed) refuse("ALREADY_RUNNING", "Lock ownership changed during recovery.", "Wait for the new owner; its lock is preserved.");
        unlinkSync(lock);
        try { writeFileSync(lock, String(process.pid), { flag: "wx" }); }
        catch { refuse("ALREADY_RUNNING", "Another invocation won the recovered claim.", "Wait for that invocation; its lock is preserved."); }
      }
    }).immediate();
  } finally { reclamation.close(); }
}
