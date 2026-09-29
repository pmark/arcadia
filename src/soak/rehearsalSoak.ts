import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * The bounded soak loop over the hermetic rehearsal harness
 * (`tests/rehearsal-two-action.test.ts`). Everything here is deterministic and
 * injectable: the driver script supplies the vitest runner, the Issue filer
 * and the state store, and the tests supply fakes.
 *
 * The loop never fixes anything itself. A blocking failure stops it, the
 * session fixes the defect and reruns the command, and the recurrence count in
 * the persisted state is what turns "the same failure again" into a stop.
 */

export const SOAK_DEFAULT_CLEAN_TARGET = 5;
export const SOAK_DEFAULT_MAX_ITERATIONS = 20;
/** The fourth occurrence of one failure is the first that follows three fix attempts. */
export const SOAK_MAX_FIX_ATTEMPTS = 3;

export type SoakStopReason =
  | "clean_target_reached"
  | "iteration_budget_exhausted"
  | "token_budget_exhausted"
  | "same_failure_after_fix_attempts"
  | "blocking_failure_needs_fix";

export interface SoakFailure {
  /** Stable across runs: hash of the test name and its normalized first error line. */
  signature: string;
  testName: string;
  message: string;
  /** `path:line` of the first repository frame in the failure's stack, when one exists. */
  location: string | null;
}

export interface SoakIterationResult {
  failures: SoakFailure[];
}

export interface SoakState {
  schema: "arcadia-rehearsal-soak-v1";
  iterations: number;
  consecutiveClean: number;
  tokensSpent: number;
  /** Occurrences of each failure signature across every run of the loop. */
  occurrences: Record<string, number>;
  issues: Record<string, string>;
  stops: Array<{ reason: SoakStopReason; detail: string; at: string }>;
}

export function emptySoakState(): SoakState {
  return { schema: "arcadia-rehearsal-soak-v1", iterations: 0, consecutiveClean: 0, tokensSpent: 0, occurrences: {}, issues: {}, stops: [] };
}

export interface SoakOptions {
  cleanTarget: number;
  maxIterations: number;
  tokenBudget: number | null;
  /** Failures whose test name contains one of these stay Issues and do not fail the iteration. */
  nonBlocking: string[];
}

export interface SoakDeps {
  runIteration(iteration: number): SoakIterationResult;
  /** Files or updates the one bug Issue for this failure and returns its reference. */
  fileIssue(failure: SoakFailure, iteration: number): string;
  save(state: SoakState): void;
  now(): Date;
  print(line: string): void;
}

export interface SoakOutcome {
  reason: SoakStopReason;
  detail: string;
  state: SoakState;
  /** Iterations executed by this invocation. */
  ranIterations: number;
}

export function runSoak(state: SoakState, options: SoakOptions, deps: SoakDeps): SoakOutcome {
  let ran = 0;
  const stop = (reason: SoakStopReason, detail: string): SoakOutcome => {
    state.stops.push({ reason, detail, at: deps.now().toISOString() });
    deps.save(state);
    deps.print(`soak stop: ${reason} -- ${detail}`);
    return { reason, detail, state, ranIterations: ran };
  };

  for (;;) {
    if (state.consecutiveClean >= options.cleanTarget) {
      return stop("clean_target_reached", `${state.consecutiveClean} consecutive clean iterations (target ${options.cleanTarget}).`);
    }
    if (options.tokenBudget !== null && state.tokensSpent >= options.tokenBudget) {
      return stop("token_budget_exhausted", `${state.tokensSpent} tokens spent of a ${options.tokenBudget} budget.`);
    }
    if (ran >= options.maxIterations) {
      return stop("iteration_budget_exhausted", `${ran} iterations run of a ${options.maxIterations} budget.`);
    }

    const iteration = state.iterations + 1;
    const result = deps.runIteration(iteration);
    ran += 1;
    state.iterations = iteration;

    const blocking: SoakFailure[] = [];
    for (const failure of result.failures) {
      state.occurrences[failure.signature] = (state.occurrences[failure.signature] ?? 0) + 1;
      state.issues[failure.signature] = deps.fileIssue(failure, iteration);
      if (!options.nonBlocking.some((fragment) => failure.testName.includes(fragment))) blocking.push(failure);
    }

    if (blocking.length === 0) {
      state.consecutiveClean += 1;
      deps.save(state);
      deps.print(`soak iteration ${iteration}: clean (${state.consecutiveClean}/${options.cleanTarget} consecutive)`);
      continue;
    }

    state.consecutiveClean = 0;
    deps.save(state);
    deps.print(`soak iteration ${iteration}: ${blocking.length} blocking failure(s)`);
    const exhausted = blocking.find((failure) => (state.occurrences[failure.signature] ?? 0) > SOAK_MAX_FIX_ATTEMPTS);
    if (exhausted) {
      return stop(
        "same_failure_after_fix_attempts",
        `"${exhausted.testName}" (${exhausted.signature}) failed again after ${SOAK_MAX_FIX_ATTEMPTS} fix attempts; see ${state.issues[exhausted.signature]}.`
      );
    }
    return stop(
      "blocking_failure_needs_fix",
      blocking.map((failure) => `"${failure.testName}" (${failure.signature}, ${failure.location ?? "no location"}) -> ${state.issues[failure.signature]}`).join("; ")
    );
  }
}

/** Stable failure identity: the test plus its first error line with volatile tokens removed. */
export function failureSignature(testName: string, message: string): string {
  const firstLine = (message.split("\n")[0] ?? "")
    .replace(/\/(?:private\/)?(?:var|tmp)\/[^\s"']*/g, "<tmp>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<time>")
    .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>");
  return createHash("sha1").update(`${testName}\n${firstLine}`).digest("hex").slice(0, 12);
}

export function firstRepositoryFrame(stackOrMessage: string): string | null {
  return /((?:tests|src|scripts)\/[^\s:()]+\.[a-z]+:\d+)/.exec(stackOrMessage)?.[1] ?? null;
}

interface VitestJsonReport {
  testResults?: Array<{
    name?: string;
    message?: string;
    assertionResults?: Array<{ fullName?: string; title?: string; status?: string; failureMessages?: string[] }>;
  }>;
}

/** Turns vitest's JSON reporter output into failures; a run that produced no report is one failure. */
export function parseVitestReport(json: string | null, exitStatus: number | null): SoakFailure[] {
  if (json === null) {
    const message = `vitest produced no JSON report (exit ${exitStatus ?? "signal"})`;
    return [{ signature: failureSignature("vitest-run", message), testName: "vitest-run", message, location: null }];
  }
  const report = JSON.parse(json) as VitestJsonReport;
  const failures: SoakFailure[] = [];
  for (const file of report.testResults ?? []) {
    const assertions = file.assertionResults ?? [];
    for (const assertion of assertions) {
      if (assertion.status !== "failed") continue;
      const testName = assertion.fullName ?? assertion.title ?? "unnamed test";
      const message = assertion.failureMessages?.join("\n") ?? "";
      failures.push({ signature: failureSignature(testName, message), testName, message, location: firstRepositoryFrame(message) });
    }
    if (assertions.length === 0 && file.message) {
      const testName = file.name ?? "unnamed suite";
      failures.push({ signature: failureSignature(testName, file.message), testName, message: file.message, location: firstRepositoryFrame(file.message) });
    }
  }
  return failures;
}

export interface FixtureCleanInput {
  repositoryPath: string;
  actionKeys: string[];
  requestIds: string[];
  now: Date;
}

function hasTable(db: Database.Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

/**
 * The residue that made the 2026-09-26 live fixtures unlaunchable although
 * `arcadia next` read them as dispatchable. Returns one line per violation;
 * an empty list is a clean fixture. A table that does not exist is clean.
 */
export function checkFixtureClean(db: Database.Database, input: FixtureCleanInput): string[] {
  const violations: string[] = [];
  const marks = (values: string[]) => values.map(() => "?").join(", ");

  if (input.actionKeys.length > 0 && hasTable(db, "production_repair_attempts")) {
    const rows = db.prepare(`SELECT action_key, attempts FROM production_repair_attempts WHERE attempts > 0 AND action_key IN (${marks(input.actionKeys)})`)
      .all(...input.actionKeys) as Array<{ action_key: string; attempts: number }>;
    for (const row of rows) violations.push(`leftover repair budget: ${row.action_key} has ${row.attempts} repair attempt(s) recorded`);
  }

  if (hasTable(db, "session_exit_receipts") && hasTable(db, "agent_sessions")) {
    const rows = db.prepare(
      `SELECT r.request_id FROM session_exit_receipts r JOIN agent_sessions s ON s.id = r.session_id
       WHERE s.repository_path = ? AND r.outcome = 'incomplete_resumable' AND r.superseded_by_session_id IS NULL`
    ).all(input.repositoryPath) as Array<{ request_id: string }>;
    for (const row of rows) violations.push(`stale handoff: unsuperseded incomplete_resumable receipt ${row.request_id}`);
  }

  if (hasTable(db, "agent_worktree_reservations")) {
    const rows = db.prepare("SELECT worktree_path, expires_at FROM agent_worktree_reservations WHERE repository_path = ? AND expires_at > ?")
      .all(input.repositoryPath, input.now.toISOString()) as Array<{ worktree_path: string; expires_at: string }>;
    for (const row of rows) violations.push(`live claim: ${row.worktree_path} is reserved until ${row.expires_at}`);
  }

  if (input.requestIds.length > 0) {
    for (const table of ["production_policy_receipts", "production_admissions"]) {
      if (!hasTable(db, table)) continue;
      const rows = db.prepare(`SELECT request_id FROM ${table} WHERE request_id IN (${marks(input.requestIds)})`).all(...input.requestIds) as Array<{ request_id: string }>;
      for (const row of rows) violations.push(`reused request_id: ${row.request_id} already has a receipt in ${table}`);
    }
  }
  return violations;
}

/**
 * Files that make up the concurrency gate, admission policy and approval
 * boundaries. The soak loop may fix a loop-blocking defect anywhere else and
 * merge it under "Merge on green"; a change touching one of these is left as
 * an open pull request for the operator.
 */
export const GATE_PATH_PATTERNS: readonly RegExp[] = [
  /^src\/production\/(policy|activation|tick)\.ts$/,
  /^src\/codingAgents\/capacity\.ts$/,
  /^src\/sessions\/(launch|launchPreview)\.ts$/,
  /^src\/stewardship\/prBlastRadius\.ts$/,
  /^src\/ask\/settlement\.ts$/,
  /^config\/defaults\//,
  /^CONSTITUTION\.md$/
];

export function gateFilesTouched(changedPaths: string[]): string[] {
  return changedPaths.filter((changed) => GATE_PATH_PATTERNS.some((pattern) => pattern.test(changed)));
}
