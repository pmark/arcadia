import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, writeTransaction } from "../src/db/connection.js";
import { observeSessionActivity } from "../src/production/stallDetection.js";
import { createId } from "../src/utils/id.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Contract 20's deterministic fault matrix, process-health boundary: whether a
 * live-but-stalled managed-production Session is flagged and recovered
 * correctly under interleaved observation, and whether the flag-write/event
 * pair `runManagedProductionTick` relies on (`src/production/tick.ts:215-226`)
 * stays atomic when the event insert fails.
 *
 * Same seeded-interleaving style as `tests/production-fault-matrix.test.ts`:
 * a mulberry32 `rng(seed)` drives two workers (separate SQLite connections to
 * one on-disk workspace) that call the real store function,
 * `observeSessionActivity`, wrapped in the exact `writeTransaction` shape
 * production uses. A "crash" is a deliberate throw injected at the one real
 * fault point this boundary has: after `observeSessionActivity`'s flag write,
 * before the stall event is inserted, inside the same transaction. Unlike the
 * admission/claim-store scenarios, this boundary has no filesystem or Git
 * component, so no candidate worktree is needed.
 *
 * Scope: this covers `observeSessionActivity`'s own transactional behavior
 * (pane/run signal tracking, baseline establishment, stall flag lifecycle,
 * capture-failure isolation, flag/event atomicity) for a live tmux Session.
 * The dead-tmux branch (`reconcileSessionExit`) is the completion/pointer
 * boundary's concern and is exercised there and in
 * `tests/session-reconciliation.test.ts`; interleaving both branches for the
 * same Session is out of scope here to keep this boundary's harness honest
 * about what it actually drives.
 */

const SEEDS_PER_SCENARIO = 100;
const STEPS_PER_RUN = 50;
// Independent of the real 20-minute `stalledSessionDeadlineMs` -- short enough
// that a seeded run's simulated clock crosses it routinely within 50 steps.
const DEADLINE_MS = 45_000;
const SESSION_COUNT = 3;

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-fault-matrix-health-"));
  temporary.push(root);
  const target = path.join(root, "workspace");
  initWorkspace(target);
  return target;
}

/** mulberry32: small, fast, and fully determined by its seed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

/** Minimal `agent_sessions` row: only the columns this boundary reads or
 * writes matter here, mirroring `tests/candidate-preservation.test.ts`'s
 * `insertLease` helper rather than the full `prepareSession` machinery, which
 * pulls in packets, tmux launch, and provider capacity unrelated to stall
 * detection. */
function insertSession(db: Database.Database, input: { id: string; tmuxSessionName: string; workItemId: string; now: Date }): void {
  db.pragma("foreign_keys = OFF");
  const ts = input.now.toISOString();
  db.prepare(
    `INSERT INTO agent_sessions (
      id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id,
      packet_id, packet_path, packet_sha256, authorizing_decisions_json, provider_profile, provider,
      model, base_revision, branch, worktree_path, provider_session_id, display_name,
      terminal_transport, tmux_session_name, status, prepared_at, created_at, updated_at
    ) VALUES (
      @id, 'proj', 'proj', @repo, 'plan.md', 'plan', 'act', @work_item_id,
      'pkt', 'pkt.md', 'sha', '[]', 'profile', 'codex-cli',
      'model', 'rev', @branch, @worktree, @psid, 'name',
      'tmux', @tmux_session_name, 'running', @ts, @ts, @ts
    )`
  ).run({
    id: input.id, work_item_id: input.workItemId, repo: `/fault-matrix/repo-${input.id}`,
    branch: `b-${input.id}`, worktree: `/fault-matrix/${input.id}`, psid: `psid-${input.id}`,
    tmux_session_name: input.tmuxSessionName, ts
  });
}

function readSession(db: Database.Database, id: string): {
  id: string; last_pane_signature: string | null; last_run_signature: string | null;
  last_activity_at: string | null; stall_flagged_at: string | null; tmux_session_name: string; work_item_id: string;
} {
  return db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id) as ReturnType<typeof readSession>;
}

/** Matches `latestRunSignal`'s query in `src/production/stallDetection.ts`:
 * the latest `execution_runs` row for a work item, by `updated_at`. */
function insertRun(db: Database.Database, input: { workItemId: string; status: string; now: Date }): void {
  db.pragma("foreign_keys = OFF");
  const ts = input.now.toISOString();
  db.prepare(
    `INSERT INTO execution_runs (id, work_item_id, status, summary, created_at, updated_at) VALUES (?, ?, ?, 'fault-matrix fixture', ?, ?)`
  ).run(createId("executionRun"), input.workItemId, input.status, ts, ts);
}

/** The exact shape `runManagedProductionTick` wraps `observeSessionActivity`
 * in (`src/production/tick.ts:215-226`): one transaction covers the flag
 * write and the stall event, so a failure between them rolls both back rather
 * than leaving a flag with no event a later tick would never retry. */
function observeInTransaction(
  db: Database.Database,
  session: ReturnType<typeof readSession>,
  tmux: { capturePane(name: string): string | null },
  now: Date,
  deadlineMs: number,
  crashBeforeEvent: boolean
): ReturnType<typeof observeSessionActivity> {
  return writeTransaction(db, () => {
    const observed = observeSessionActivity(db, session as never, tmux, now, deadlineMs);
    if (observed.newlyStalled) {
      if (crashBeforeEvent) throw new Error("injected crash: after flag write, before event insert");
      db.prepare(
        `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
         VALUES (?, 'managed_production.session_stalled', 'managed_production_tick', NULL, NULL, NULL, NULL, ?, ?)`
      ).run(createId("event"), JSON.stringify({ schemaVersion: 1, sessionId: session.id }), now.toISOString());
    }
    return observed;
  });
}

function stallEventCount(db: Database.Database, sessionId: string): number {
  const rows = db.prepare(
    `SELECT payload_json FROM events WHERE event_type = 'managed_production.session_stalled'`
  ).all() as Array<{ payload_json: string }>;
  return rows.filter((row) => (JSON.parse(row.payload_json) as { sessionId?: string }).sessionId === sessionId).length;
}

interface SessionState {
  id: string;
  workItemId: string;
  tmuxSessionName: string;
  /** What the harness's fixture tmux would currently show; controls the next `capturePane`. */
  paneText: string;
  runStatus: string;
  /** Running count of `newlyStalled: true` results this session has produced, for the atomicity invariant. */
  flaggedCount: number;
}

interface Harness {
  seed: number;
  random: () => number;
  operator: Database.Database;
  workers: Database.Database[];
  clock: number;
  sessions: SessionState[];
  timeline: string[];
}

type OpName = "progress-pane" | "progress-run" | "no-progress" | "capture-null" | "capture-throw" | "crash-before-event" | "tick-clock";

const WEIGHTS: Partial<Record<OpName, number>> = {
  "progress-pane": 3, "progress-run": 2, "no-progress": 5, "capture-null": 2,
  "capture-throw": 2, "crash-before-event": 3, "tick-clock": 4
};

function weightedOp(random: () => number): OpName {
  const entries = Object.entries(WEIGHTS) as Array<[OpName, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return entries.at(-1)![0];
}

function now(harness: Harness): Date {
  return new Date(Date.parse("2026-09-23T00:00:00.000Z") + harness.clock);
}

function violation(harness: Harness, message: string): never {
  const evidence = { scenario: "process-health", seed: harness.seed, violation: message, timeline: harness.timeline };
  const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `violation-process-health-${harness.seed}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  throw new Error(`Invariant violated [process-health seed ${harness.seed}]: ${message}\n${harness.timeline.join("\n")}`);
}

/** Invariants checked after every step, read from the database itself. */
function checkInvariants(harness: Harness): void {
  for (const session of harness.sessions) {
    const row = readSession(harness.operator, session.id);
    // The flag/event pair production wraps in one transaction is exactly
    // this: a session can never carry more confirmed stall flags than it has
    // matching events, and never fewer -- an event lost after the flag
    // committed is exactly the bug the transaction exists to prevent.
    const events = stallEventCount(harness.operator, session.id);
    if (events !== session.flaggedCount) {
      violation(harness, `${session.id}: ${session.flaggedCount} confirmed stalls but ${events} stall events recorded`);
    }
    // A capture/observation never resurrects a cleared activity clock.
    if (row.last_activity_at === null && session.flaggedCount > 0) {
      violation(harness, `${session.id}: flagged stalled but last_activity_at was never established`);
    }
  }
}

function step(harness: Harness, op: OpName): void {
  const worker = pick(harness.random, harness.workers);
  const session = pick(harness.random, harness.sessions);
  const at = now(harness);
  const log = (message: string) => harness.timeline.push(`t+${harness.clock}ms ${message}`);

  switch (op) {
    case "progress-pane": {
      session.paneText = `${session.paneText}\nline-${harness.random()}`;
      const before = readSession(worker, session.id);
      const observed = observeInTransaction(worker, before, { capturePane: () => session.paneText }, at, DEADLINE_MS, false);
      log(`${session.id} progress-pane -> recovered=${observed.recovered} stalled=${observed.stalled}`);
      return;
    }
    case "progress-run": {
      session.runStatus = session.runStatus === "running" ? "requires_review" : "running";
      insertRun(worker, { workItemId: session.workItemId, status: session.runStatus, now: at });
      const before = readSession(worker, session.id);
      const observed = observeInTransaction(worker, before, { capturePane: () => session.paneText }, at, DEADLINE_MS, false);
      log(`${session.id} progress-run -> recovered=${observed.recovered} stalled=${observed.stalled}`);
      return;
    }
    case "no-progress": {
      const before = readSession(worker, session.id);
      const observed = observeInTransaction(worker, before, { capturePane: () => session.paneText }, at, DEADLINE_MS, false);
      if (observed.newlyStalled) session.flaggedCount += 1;
      log(`${session.id} no-progress -> newlyStalled=${observed.newlyStalled} stalled=${observed.stalled}`);
      return;
    }
    case "capture-null": {
      const before = readSession(worker, session.id);
      const observed = observeInTransaction(worker, before, { capturePane: () => null }, at, DEADLINE_MS, false);
      if (observed.newlyStalled) session.flaggedCount += 1;
      log(`${session.id} capture-null -> newlyStalled=${observed.newlyStalled} stalled=${observed.stalled}`);
      return;
    }
    case "capture-throw": {
      // The unguarded `tmux.capturePane(...)` call in `observeSessionActivity`
      // computes `paneText` before any database write, so a throwing capture
      // must leave the row byte-identical to before -- exactly like a real
      // tmux failure, caught one level up by the tick's own per-project
      // try/catch (`src/production/tick.ts:236-238`).
      const before = readSession(worker, session.id);
      try {
        observeInTransaction(worker, before, { capturePane: () => { throw new Error("tmux capture failed"); } }, at, DEADLINE_MS, false);
        violation(harness, `${session.id}: capture-throw did not propagate`);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("tmux capture failed")) throw error;
      }
      const after = readSession(worker, session.id);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        violation(harness, `${session.id}: a throwing tmux capture changed session state (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`);
      }
      log(`${session.id} capture-throw -> row unchanged, as required`);
      return;
    }
    case "crash-before-event": {
      // Force a stall this tick regardless of the clock, by observing far
      // past any deadline, then inject the crash between the flag write and
      // the event insert. The whole transaction must roll back.
      const before = readSession(worker, session.id);
      let crashed = false;
      try {
        observeInTransaction(worker, before, { capturePane: () => session.paneText }, at, 0, true);
      } catch (error) {
        crashed = true;
        if (!(error instanceof Error) || !error.message.includes("injected crash")) throw error;
      }
      const after = readSession(worker, session.id);
      if (crashed && before.stall_flagged_at !== after.stall_flagged_at) {
        violation(harness, `${session.id}: crash between flag write and event insert did not roll back (before ${before.stall_flagged_at}, after ${after.stall_flagged_at})`);
      }
      log(`${session.id} crash-before-event -> crashed=${crashed}, rolled back cleanly`);
      // Retry immediately without the injected crash: production's next tick
      // does exactly this, and it must now commit both halves together.
      const retried = observeInTransaction(worker, after, { capturePane: () => session.paneText }, at, 0, false);
      if (retried.newlyStalled) session.flaggedCount += 1;
      log(`${session.id} crash-before-event retry -> newlyStalled=${retried.newlyStalled}`);
      return;
    }
    case "tick-clock": {
      harness.clock += Math.floor(harness.random() * 30_000);
      log(`clock advances`);
      return;
    }
  }
}

function runScenario(seed: number): { steps: number; flagged: number; recovered: number } {
  const target = workspace();
  const random = rng(seed);
  const operator = openDatabase(target);
  const workers = ["worker-a", "worker-b"].map(() => openDatabase(target));
  const baseNow = new Date("2026-09-23T00:00:00.000Z");
  const sessions: SessionState[] = ["alpha", "beta", "gamma"].slice(0, SESSION_COUNT).map((name, index) => {
    const id = `${seed}-${name}`;
    insertSession(operator, { id, tmuxSessionName: `tmux-${id}`, workItemId: `wi-${id}`, now: baseNow });
    return { id, workItemId: `wi-${id}`, tmuxSessionName: `tmux-${id}`, paneText: `boot-${index}`, runStatus: "running", flaggedCount: 0 };
  });
  const harness: Harness = { seed, random, operator, workers, clock: 0, sessions, timeline: [] };
  let recovered = 0;
  try {
    for (let index = 0; index < STEPS_PER_RUN; index += 1) {
      const op = weightedOp(random);
      const before = harness.sessions.map((session) => readSession(operator, session.id).stall_flagged_at);
      step(harness, op);
      const after = harness.sessions.map((session) => readSession(operator, session.id).stall_flagged_at);
      for (let session = 0; session < before.length; session += 1) {
        if (before[session] !== null && after[session] === null) recovered += 1;
      }
      checkInvariants(harness);
    }
    const flagged = harness.sessions.reduce((sum, session) => sum + session.flaggedCount, 0);
    return { steps: STEPS_PER_RUN, flagged, recovered };
  } finally {
    for (const worker of workers) worker.close();
    operator.close();
  }
}

describe("contract-20 fault matrix (process health)", () => {
  it(`process-health: ${SEEDS_PER_SCENARIO} seeded interleavings hold every invariant`, () => {
    const totals = { steps: 0, flagged: 0, recovered: 0 };
    for (let seed = 1; seed <= SEEDS_PER_SCENARIO; seed += 1) {
      const result = runScenario(seed);
      totals.steps += result.steps;
      totals.flagged += result.flagged;
      totals.recovered += result.recovered;
    }
    // Guard against a vacuous pass: the scenario must actually flag and
    // recover stalls, and exercise the crash-before-event rollback, not just
    // churn through no-op ticks.
    expect(totals.flagged).toBeGreaterThan(0);
    expect(totals.recovered).toBeGreaterThan(0);
    const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "summary-process-health.json"), `${JSON.stringify({ scenario: "process-health", seeds: SEEDS_PER_SCENARIO, violations: 0, ...totals }, null, 2)}\n`);
    }
  }, 120_000);
});
