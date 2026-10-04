import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PullRequestCheckRun } from "../../src/qa/prReview.js";

/**
 * statusCheckRollup payloads captured from pmark/arcadia pull requests
 * (tests/fixtures/github/status-check-rollups.json): each case is either the
 * verbatim GitHub list (`captured`) or a captured list with one named change
 * in the captured field shape (`derived`).
 */
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "github", "status-check-rollups.json");

interface RollupCase {
  origin: "captured" | "derived";
  rollup: PullRequestCheckRun[];
}

const cases = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Record<string, RollupCase> }).cases;

export type RollupCaseName =
  | "checkRunOnly"
  | "checkRunsWithCodeRabbitSuccess"
  | "checkRunsWithCodeRabbitPending"
  | "failedCheckRunWithCodeRabbit"
  | "codeRabbitOnly"
  | "empty"
  | "pendingNonAdvisoryStatusContext"
  | "expectedNonAdvisoryStatusContext"
  | "failedNonAdvisoryStatusContext"
  | "erroredNonAdvisoryStatusContext"
  | "successfulNonAdvisoryStatusContext"
  | "codeRabbitFailed"
  | "codeRabbitErrored"
  | "codeRabbitPendingWithPendingCheckRun"
  | "unknownEntryShape";

/** A fresh deep copy of one fixture's rollup, so a test can never mutate another's. */
export function rollup(name: RollupCaseName): PullRequestCheckRun[] {
  const found = cases[name];
  if (!found) throw new Error(`No status-check rollup fixture named ${name}.`);
  return structuredClone(found.rollup);
}

export function rollupOrigin(name: RollupCaseName): RollupCase["origin"] {
  return cases[name].origin;
}
