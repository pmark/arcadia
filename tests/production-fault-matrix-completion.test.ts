import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { previewAgentAskRequest } from "../src/ask/preview.js";
import { settleAgentAsk, type AgentAskSettlementTestHooks } from "../src/ask/settlement.js";
import { openDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import type { PlanDoc } from "../src/docs/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * Contract 20's deterministic fault matrix, completion and pointer boundary:
 * the pipeline the evidence index names "evidence -> document write -> commit
 * -> queue projection -> receipt", which is `settleAgentAsk`'s `complete`
 * intent (`src/ask/settlement.ts`). Two workers interleave completions of
 * different Actions against one shared repository and workspace, exactly like
 * `tests/production-fault-matrix.test.ts`'s existing scenarios, but every
 * step here is a real Git commit, not only a SQLite row -- this boundary's own
 * durable output is the checked-in Plan/Project documents, not a database
 * projection of them.
 *
 * Crash injection uses `AgentAskSettlementTestHooks`
 * (`src/ask/settlement.ts:121`), the same deliberate seam
 * `tests/agent-ask-complete.test.ts` and `tests/session-reconciliation.test.ts`
 * already use one fault at a time. The highest-value op here,
 * `race-settle`, uses `beforeDocumentWrite` for its documented purpose: landing
 * a second worker's *complete* settlement for a different Action inside the
 * first worker's write window, to prove the pointer pair's compare-and-set
 * re-reads and re-applies rather than overwriting the second worker's change
 * (`src/ask/settlement.ts:960-970`).
 *
 * `preserveCandidate` and `reconcileSessionExit` (the surrounding pipeline
 * this boundary evidence-indexes alongside) already have their own seeded
 * single-fault coverage in `tests/candidate-preservation.test.ts` and
 * `tests/session-reconciliation.test.ts`; interleaving those too would need a
 * full agent-Session/tmux/production-policy fixture this Action's dependency,
 * `detect-hung-managed-production-sessions`, already covers on its own tmux
 * axis (`tests/production-fault-matrix-process-health.test.ts`). This
 * scenario stays scoped to what is new: seeded interleaving across
 * `settleAgentAsk`'s own document-write/commit/projection/receipt pipeline.
 */

const SEEDS_PER_SCENARIO = 100;
const STEPS_PER_RUN = 24;
const ACTION_IDS = ["alpha", "beta", "gamma", "delta"] as const;

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

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

function g(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Fault Matrix", GIT_AUTHOR_EMAIL: "fault-matrix@example.test", GIT_COMMITTER_NAME: "Fault Matrix", GIT_COMMITTER_EMAIL: "fault-matrix@example.test" }
  }).trim();
}

function planDoc(): string {
  const actions = ACTION_IDS.map((id) => [
    `  - id: ${id}`, `    title: Action ${id}`, "    status: open",
    "    responsibility: agent", "    effort: session", `    next_action: Finish ${id}.`,
    `    expected_artifact: Proof of ${id}`, "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", `      - Proof of ${id} exists.`, "    depends_on: []", "    decisions: []", "    references: []"
  ].join("\n")).join("\n");
  return [
    "---", "arcadia: v1", "type: plan", "slug: fm-plan", "project: fm", "status: active",
    "milestone: Fault matrix", "current_action: alpha", "token_impact: medium",
    "token_budget: Deterministic completion fault matrix fixture.",
    "recommended_model: claude-sonnet-5",
    "updated: 2026-09-23", "actions:", actions, "questions: []", "---", "", "# Fault matrix plan", ""
  ].join("\n");
}

function projectDoc(): string {
  return [
    "---", "arcadia: v1", "type: project", "slug: fm", "name: Fault Matrix", "status: active",
    "goal: Prove the completion boundary.", "milestone: Fault matrix", "active_plan: fm-plan", "current_action: alpha",
    "updated: 2026-09-23", "---", "", "# Fault matrix", ""
  ].join("\n");
}

interface Fixture {
  repo: string;
  workspace: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-fault-matrix-completion-"));
  temporary.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
  writeFileSync(path.join(repo, ".arcadia/asks/archive/.gitkeep"), "", "utf8");
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/plans/fm-plan.md"), planDoc(), "utf8");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  g(repo, ["config", "user.name", "Fault Matrix"]);
  g(repo, ["config", "user.email", "fault-matrix@example.test"]);
  g(repo, ["add", "-A"]);
  g(repo, ["commit", "-q", "-m", "fault matrix fixture"]);

  initWorkspace(workspace);
  const db = openDatabase(workspace);
  try {
    const project = upsertProject(db, {
      name: "fm", mission: "Prove the completion boundary.", goal: "Prove the completion boundary.",
      status: "active", currentMilestone: "Fault matrix", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: ACTION_IDS.map((id) => `fm/${id}`), order: ACTION_IDS.map((id) => `fm/${id}`),
      requestId: "fixture-order", apply: true
    });
  } finally {
    db.close();
  }
  return { repo, workspace };
}

function completeAskRequest(requestId: string, actionId: string, candidateRevision: string): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, "project: fm", "intent: complete",
    `target_ref: action/${actionId}`, `desired_result: Accept the completion evidence for ${actionId}`,
    "rationale: Every declared criterion is met.", `candidate_revision: ${candidateRevision}`,
    "evidence:", `  - criterion: "Proof of ${actionId} exists."`, "    status: met", "    note: Verified.",
    "requested_authority: apply_if_approved", ""
  ].join("\n");
}

interface Proposal {
  proposalId: string;
  requestId: string;
  actionId: string;
  settlementRequestId: string;
  settled: boolean;
}

interface Worker {
  name: string;
  db: Database.Database;
  /** One proposal per Action this worker has built, keyed by Action id. */
  proposals: Map<string, Proposal>;
}

interface Harness {
  seed: number;
  random: () => number;
  fixture: Fixture;
  workers: Worker[];
  timeline: string[];
  raceCount: number;
  crashCount: number;
}

type OpName = "propose" | "settle" | "settle-crash" | "race-settle" | "retry" | "advance-head";

const WEIGHTS: Partial<Record<OpName, number>> = {
  propose: 4, settle: 5, "settle-crash": 3, "race-settle": 2, retry: 3, "advance-head": 2
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

function violation(harness: Harness, message: string): never {
  const evidence = { scenario: "completion-pointer", seed: harness.seed, violation: message, timeline: harness.timeline };
  const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `violation-completion-pointer-${harness.seed}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  throw new Error(`Invariant violated [completion-pointer seed ${harness.seed}]: ${message}\n${harness.timeline.join("\n")}`);
}

function currentHead(harness: Harness): string {
  return g(harness.fixture.repo, ["rev-parse", "HEAD"]);
}


/** Ground truth this harness itself commits an Action to, updated whenever a
 * `settleAgentAsk` call got past `beforeDocumentWrite` (Phase 1) -- the one
 * point before which nothing is written (`src/ask/settlement.ts:942-1091`
 * documents Phase 2, the commit, as unconditional once that point is
 * passed). A `Set` is the right shape here, not a throw-on-duplicate check:
 * an idempotent replay of an already-applied settlement legitimately calls
 * this again for the same Action, and `settleAgentAsk` itself is what
 * actually refuses a genuine second completion (`action.status === "done"`,
 * `src/ask/settlement.ts:656`) -- that refusal is what `checkInvariants`
 * verifies against the Plan file, not this bookkeeping. */
function markExpectedDone(expectedDone: Set<string>, actionId: string): void {
  expectedDone.add(actionId);
}

/**
 * Whether the documents (the Plan's `status: done`) are committed to disk
 * once a hook throws at the named point. Phase 2, the Git commit, is
 * unconditional between `beforeDocumentWrite` and `beforeOperationalSync`
 * (`src/ask/settlement.ts:942-1091`): a crash *at* `beforeDocumentWrite`
 * fires before anything is written, so nothing commits; a crash at either
 * later point fires after Phase 2 already ran, so the commit stands even
 * though the operational projection or receipt is what failed.
 */
function documentsCommitAt(point: "beforeDocumentWrite" | "beforeOperationalSync" | "beforeOperationalProjection" | undefined): boolean {
  return point !== "beforeDocumentWrite";
}

function attemptSettle(
  harness: Harness, worker: Worker, proposal: Proposal, expectedDone: Set<string>,
  crashAt?: "beforeDocumentWrite" | "beforeOperationalSync" | "beforeOperationalProjection"
): { applied: boolean; crashed: boolean } {
  const hooks: AgentAskSettlementTestHooks | undefined = crashAt
    ? { [crashAt]: () => { throw new Error(`injected crash: ${crashAt}`); } }
    : undefined;
  try {
    // `apply: true` is refused unless it names the current preview
    // fingerprint (`src/ask/settlement.ts:880-885`), so every attempt -- first
    // try or retry alike -- previews first. When `settlementRequestId` already
    // has a persisted row, this preview call itself returns that stored
    // receipt directly (`src/ask/settlement.ts:194-201`), and the second call
    // below is skipped -- that IS the idempotent replay.
    const preview = settleAgentAsk(worker.db, {
      proposalRef: proposal.proposalId, settlementRequestId: proposal.settlementRequestId, disposition: "accepted"
    });
    const receipt = preview.applied
      ? preview
      : settleAgentAsk(worker.db, {
          proposalRef: proposal.proposalId, settlementRequestId: proposal.settlementRequestId,
          disposition: "accepted", apply: true, previewFingerprint: preview.previewFingerprint
        }, hooks);
    // `beforeOperationalSync` is the one hook `settleAgentAsk` itself catches
    // internally (it is inside the operational-projection transaction's own
    // try/catch, `src/ask/settlement.ts:1069-1152`): it never reaches this
    // catch block, instead returning normally with `applied: true` and a
    // `recovery` describing the pending projection. The documents are still
    // committed, so this still counts as done.
    if (receipt.applied) markExpectedDone(expectedDone, proposal.actionId);
    proposal.settled = true;
    return { applied: receipt.applied, crashed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("injected crash:")) {
      if (documentsCommitAt(crashAt)) markExpectedDone(expectedDone, proposal.actionId);
      proposal.settled = true;
      return { applied: false, crashed: true };
    }
    // A real refusal (stale candidate revision, already done, etc.) is
    // expected under interleaving -- not a harness failure.
    harness.timeline.push(`${worker.name} settle ${proposal.actionId} refused: ${message.slice(0, 80)}`);
    return { applied: false, crashed: false };
  }
}

/** Like `attemptSettle`, but its `beforeDocumentWrite` window runs `onWindow`
 * instead of throwing -- the race mechanic, not a crash. */
function attemptSettleRacing(
  harness: Harness, worker: Worker, proposal: Proposal, expectedDone: Set<string>, onWindow: () => void
): { applied: boolean; crashed: boolean } {
  try {
    const preview = settleAgentAsk(worker.db, {
      proposalRef: proposal.proposalId, settlementRequestId: proposal.settlementRequestId, disposition: "accepted"
    });
    const receipt = preview.applied
      ? preview
      : settleAgentAsk(worker.db, {
          proposalRef: proposal.proposalId, settlementRequestId: proposal.settlementRequestId,
          disposition: "accepted", apply: true, previewFingerprint: preview.previewFingerprint
        }, { beforeDocumentWrite: onWindow });
    if (receipt.applied) markExpectedDone(expectedDone, proposal.actionId);
    proposal.settled = true;
    return { applied: receipt.applied, crashed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    harness.timeline.push(`${worker.name} race-settle ${proposal.actionId} refused: ${message.slice(0, 80)}`);
    return { applied: false, crashed: false };
  }
}

function step(harness: Harness, expectedDone: Set<string>, op: OpName): void {
  const worker = pick(harness.random, harness.workers);
  const other = harness.workers.find((candidate) => candidate !== worker)!;
  const log = (message: string) => harness.timeline.push(message);

  switch (op) {
    case "propose": {
      const candidates = ACTION_IDS.filter((id) => !expectedDone.has(id) && !worker.proposals.has(id));
      if (candidates.length === 0) return;
      const actionId = pick(harness.random, candidates);
      const head = currentHead(harness);
      const requestId = `${worker.name}-propose-${actionId}-${worker.proposals.size}`;
      const preview = previewAgentAskRequest(worker.db, { request: completeAskRequest(requestId, actionId, head), requestId });
      worker.proposals.set(actionId, {
        proposalId: preview.proposal.id, requestId, actionId, settlementRequestId: `${worker.name}-settle-${actionId}`, settled: false
      });
      log(`${worker.name} propose ${actionId} at ${head.slice(0, 8)}`);
      return;
    }
    case "settle": {
      const candidates = [...worker.proposals.values()].filter((p) => !p.settled && !expectedDone.has(p.actionId));
      if (candidates.length === 0) return;
      const proposal = pick(harness.random, candidates);
      const result = attemptSettle(harness, worker, proposal, expectedDone);
      log(`${worker.name} settle ${proposal.actionId} -> applied=${result.applied}`);
      return;
    }
    case "settle-crash": {
      const candidates = [...worker.proposals.values()].filter((p) => !p.settled && !expectedDone.has(p.actionId));
      if (candidates.length === 0) return;
      const proposal = pick(harness.random, candidates);
      const point = pick(harness.random, ["beforeDocumentWrite", "beforeOperationalSync", "beforeOperationalProjection"] as const);
      const result = attemptSettle(harness, worker, proposal, expectedDone, point);
      harness.crashCount += 1;
      log(`${worker.name} settle-crash ${proposal.actionId} at ${point} -> crashed=${result.crashed}`);
      return;
    }
    case "race-settle": {
      const candidates = [...worker.proposals.values()].filter((p) => !p.settled && !expectedDone.has(p.actionId));
      const otherCandidates = [...other.proposals.values()].filter((p) => !p.settled && !expectedDone.has(p.actionId) && p.actionId !== candidates[0]?.actionId);
      if (candidates.length === 0 || otherCandidates.length === 0) return;
      const proposal = candidates[0];
      const otherProposal = pick(harness.random, otherCandidates);
      let raced = false;
      const result = attemptSettleRacing(harness, worker, proposal, expectedDone, () => {
        raced = true;
        harness.raceCount += 1;
        // The other worker's own complete settlement lands *inside* this
        // worker's write window -- the exact case `beforeDocumentWrite`
        // exists to prove correct (src/ask/settlement.ts:122-127).
        attemptSettle(harness, other, otherProposal, expectedDone);
      });
      log(`${worker.name} race-settle ${proposal.actionId} (racing ${other.name}'s ${otherProposal.actionId}) -> raced=${raced} applied=${result.applied}`);
      return;
    }
    case "retry": {
      const candidates = [...worker.proposals.values()].filter((p) => p.settled);
      if (candidates.length === 0) return;
      const proposal = pick(harness.random, candidates);
      const result = attemptSettle(harness, worker, proposal, expectedDone);
      log(`${worker.name} retry ${proposal.actionId} -> applied=${result.applied}`);
      return;
    }
    case "advance-head": {
      const scratch = path.join(harness.fixture.repo, `scratch-${harness.timeline.length}.txt`);
      writeFileSync(scratch, "advance\n", "utf8");
      g(harness.fixture.repo, ["add", "-A"]);
      g(harness.fixture.repo, ["commit", "-q", "-m", "advance head"]);
      log(`head advances to ${currentHead(harness).slice(0, 8)}`);
      return;
    }
  }
}

/** Invariants checked after every step, read from the filesystem and Git
 * themselves -- this boundary's durable output, not a database projection. */
function checkInvariants(harness: Harness, expectedDone: Set<string>): void {
  const discovered = discoverDocs(harness.fixture.repo);
  const plan = discovered.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.slug === "fm-plan");
  for (const action of plan?.actions ?? []) {
    const shouldBeDone = expectedDone.has(action.id);
    const isDone = action.status === "done";
    if (shouldBeDone !== isDone) {
      violation(harness, `${action.id}: harness expected done=${shouldBeDone} but the Plan says status=${action.status}`);
    }
  }
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: harness.fixture.repo, encoding: "utf8" });
  if (status.trim()) {
    violation(harness, `repository is not clean after a settlement step: ${status.trim()}`);
  }
  const project = discovered.docs.find((doc) => doc.type === "project");
  if (project && project.type === "project" && project.currentAction && expectedDone.has(project.currentAction)) {
    // A stale pointer onto an already-done Action is a real, if narrow, race:
    // `selectNextAfterCompletion`'s target is resolved once and pinned before
    // `beforeDocumentWrite`, deliberately never re-derived on a compare-and-set
    // retry ("it never re-derives current_action from fresh queue state, which
    // could silently retarget a different Action than the one this settlement
    // resolved and previewed" -- src/ask/settlement.ts:735-738). Two different
    // Actions completing inside each other's write window can each pin a
    // now-stale target. What must hold is the documented downstream safety
    // net: dispatch refuses a done pointer rather than redispatching it
    // (`src/docs/dispatch.ts:279-281`), not that the pointer is instantaneously
    // fresh under concurrent completions.
    const dispatch = resolveDispatch(harness.fixture.repo, "fm");
    const staleBlocker = dispatch.blockers.find((blocker) =>
      blocker.field === "current_action" && blocker.message.includes("is already done"));
    if (!staleBlocker) {
      violation(harness, `pointer names ${project.currentAction}, which is already done, and resolveDispatch did not refuse it: ${JSON.stringify(dispatch.blockers)}`);
    }
  }
}

function runScenario(seed: number): { steps: number; completed: number; raced: number; crashed: number } {
  const fixture = makeFixture();
  const random = rng(seed);
  const workers: Worker[] = ["worker-a", "worker-b"].map((name) => ({ name, db: openDatabase(fixture.workspace), proposals: new Map() }));
  const harness: Harness = { seed, random, fixture, workers, timeline: [], raceCount: 0, crashCount: 0 };
  const expectedDone = new Set<string>();
  try {
    for (let index = 0; index < STEPS_PER_RUN; index += 1) {
      step(harness, expectedDone, weightedOp(random));
      checkInvariants(harness, expectedDone);
    }
    return { steps: STEPS_PER_RUN, completed: expectedDone.size, raced: harness.raceCount, crashed: harness.crashCount };
  } finally {
    for (const worker of workers) worker.db.close();
  }
}

describe("contract-20 fault matrix (completion and pointer)", () => {
  it(`completion-pointer: ${SEEDS_PER_SCENARIO} seeded interleavings hold every invariant`, () => {
    const totals = { steps: 0, completed: 0, raced: 0, crashed: 0 };
    for (let seed = 1; seed <= SEEDS_PER_SCENARIO; seed += 1) {
      const result = runScenario(seed);
      totals.steps += result.steps;
      totals.completed += result.completed;
      totals.raced += result.raced;
      totals.crashed += result.crashed;
    }
    // Guard against a vacuous pass: completions, the race window, and crash
    // injection must all actually have fired somewhere across the seeds.
    expect(totals.completed).toBeGreaterThan(0);
    expect(totals.raced).toBeGreaterThan(0);
    expect(totals.crashed).toBeGreaterThan(0);
    const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "summary-completion-pointer.json"), `${JSON.stringify({ scenario: "completion-pointer", seeds: SEEDS_PER_SCENARIO, violations: 0, ...totals }, null, 2)}\n`);
    }
  }, 300_000);
});
