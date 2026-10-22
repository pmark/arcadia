import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";

/** Shared by worker and manual QA. Never steal an uncertain claim after a crash. */
export function withPrReviewExecutionClaim<T>(pullRequestReceiptRoot: string, run: () => T): T {
  mkdirSync(pullRequestReceiptRoot, { recursive: true });
  const claim = path.join(pullRequestReceiptRoot, ".execution-claim");
  try { mkdirSync(claim); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw validationError("Reviewer execution is already claimed; no second reviewer may run. Preserve an uncertain owner claim for diagnosis.", { code: "review_execution_claimed", claim });
  }
  try {
    writeFileSync(path.join(claim, "owner.json"), JSON.stringify({ pid: process.pid, claimedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    return run();
  } finally {
    rmSync(claim, { recursive: true });
  }
}
