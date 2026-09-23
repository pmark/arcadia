import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { CapacityAdmissionDecision } from "../src/codingAgents/capacity.js";
import { openDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import {
  activateProduction,
  commitAdmission,
  deactivateProduction,
  fingerprintProductionScope,
  issueAdmission,
  normalizeProductionScope,
  readProductionPolicy,
  releaseAdmission,
  type AdmissionOutcome,
  type ProductionScope
} from "../src/production/policy.js";
import { releaseActionClaim, reserveAgentWorktree } from "../src/sessions/index.js";

/**
 * Contract 20's deterministic fault matrix, for the boundaries that live in the
 * policy and claim store: admission/launch, Off, capacity, and
 * priority/authority.
 *
 * Each scenario is a seeded generator of operations by two independent workers
 * (separate SQLite connections to one workspace database) and the operator.
 * Every operation is one real store call — `issueAdmission`,
 * `reserveAgentWorktree`, `commitAdmission`, `activateProduction`,
 * `deactivateProduction` — so interleavings are explored at transaction
 * granularity; atomicity inside a transaction is SQLite's `BEGIN IMMEDIATE`,
 * not something this harness simulates. A "crash" drops a worker's in-memory
 * state (a lost response) and its retry replays the same request id, exactly as
 * a restarted tick would.
 *
 * The invariants are checked after every step against the database itself.
 * A violation fails with the scenario, seed, and full timeline, and writes them
 * to `ARCADIA_FAULT_MATRIX_EVIDENCE_DIR` when set, so the failing interleaving
 * is reproducible by seed alone. Record ids are random; the operation sequence
 * is not, and nothing checked here depends on an id's value.
 *
 * This is a regression screen, not a statistical claim about production
 * failure rates (contract 20).
 */

const SEEDS_PER_SCENARIO = 100;
const STEPS_PER_RUN = 60;
const REPO = "/fault-matrix/repo";
const ACTIONS = ["demo/migrate", "demo/ship-it", "demo/polish"] as const;
const PROVIDERS = ["claude", "codex"] as const;

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-fault-matrix-"));
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

type CapacityState = "fresh" | "refused" | "unknown" | "mismatched";

function capacityFor(provider: string, state: CapacityState): CapacityAdmissionDecision {
  if (state === "unknown") return undefined as unknown as CapacityAdmissionDecision;
  const providerId = state === "mismatched" ? (provider === "claude" ? "codex" : "claude") : provider;
  const admitted = state !== "refused";
  return {
    providerId,
    admitted,
    code: admitted ? null : "window_exhausted",
    reason: admitted ? `${providerId} fixture allowance.` : `${providerId} fixture window exhausted.`,
    unattendedProof: admitted,
    retryAfter: null,
    refreshRequired: !admitted,
    receipt: {
      version: 1,
      providerId,
      providerLabel: providerId,
      profiles: [],
      accountScope: "fault-matrix",
      source: "codex_app_server",
      evidence: "simulated",
      unattended: true,
      observedAt: "2026-09-22T00:00:00.000Z",
      observedAgeMs: 0,
      expiresAt: null,
      confidence: "observed",
      freshness: "fresh",
      usagePolicy: "included",
      usagePolicyReason: "fault-matrix fixture",
      windows: [],
      nextResetAt: null,
      unsupported: [],
      availability: admitted ? "available" : "exhausted",
      telemetry: "fault-matrix fixture"
    }
  } as CapacityAdmissionDecision;
}

interface Pending {
  requestId: string;
  actionKey: string;
  provider: string;
  receiptId: string | null;
  claimGeneration: string | null;
  committed: boolean;
}

interface Worker {
  name: string;
  db: Database.Database;
  cachedEpoch: number | undefined;
  pending: Pending[];
  counter: number;
}

interface Harness {
  scenario: string;
  seed: number;
  random: () => number;
  operator: Database.Database;
  workers: Worker[];
  clock: number;
  capacity: CapacityState;
  maxConcurrent: number;
  /** Every request id ever issued with the receipt id first returned for it. */
  receiptsByRequest: Map<string, string>;
  timeline: string[];
  grants: number;
}

type OpName =
  | "issue" | "retry" | "claim" | "commit" | "finish" | "crash" | "refresh-epoch"
  | "off" | "on" | "rescope" | "tick-clock" | "capacity";

const SCENARIOS: Record<string, Partial<Record<OpName, number>>> = {
  // Two workers, repeated requests, lost responses, crash before/after spawn.
  "admission-launch": { issue: 4, retry: 3, claim: 4, commit: 4, finish: 2, crash: 2, "refresh-epoch": 1, "tick-clock": 1 },
  // Off racing claim/commit, stale workers, reactivation.
  off: { issue: 3, retry: 1, claim: 2, commit: 3, finish: 1, crash: 1, "refresh-epoch": 1, off: 2, on: 2, "tick-clock": 1 },
  // Stale/unknown/refused observations and resets.
  capacity: { issue: 4, retry: 1, claim: 1, commit: 2, finish: 2, crash: 1, "refresh-epoch": 1, capacity: 3, "tick-clock": 1 },
  // Reorder/rescope and revoked policy while work is in flight.
  "priority-authority": { issue: 3, retry: 1, claim: 2, commit: 3, finish: 1, crash: 1, "refresh-epoch": 1, rescope: 3, off: 1, "tick-clock": 1 }
};

function weightedOp(random: () => number, weights: Partial<Record<OpName, number>>): OpName {
  const entries = Object.entries(weights) as Array<[OpName, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return entries.at(-1)![0];
}

function now(harness: Harness): Date {
  return new Date(Date.parse("2026-09-22T00:00:00.000Z") + harness.clock);
}

function grant(harness: Harness): void {
  // A rescope is a fresh activation with a different ordered Action list, which
  // is how an operator reorders or narrows authority.
  const actions = [...ACTIONS].filter(() => harness.random() < 0.7);
  const authorized: ProductionScope = normalizeProductionScope({
    intent: "Fault matrix standing authorization.",
    projects: ["demo"],
    plans: ["demo/queue-plan"],
    actions: actions.length ? actions : [ACTIONS[0]],
    providers: harness.random() < 0.8 ? [...PROVIDERS] : ["claude"],
    maxConcurrentSessions: harness.maxConcurrent,
    mechanicalTransitions: ["validation", "acceptance", "pointer"]
  });
  harness.grants += 1;
  activateProduction(harness.operator, {
    requestId: `${harness.scenario}-${harness.seed}-grant-${harness.grants}`,
    scope: authorized,
    scopeFingerprint: fingerprintProductionScope(authorized),
    grantedBy: "operator",
    now: now(harness)
  });
}

function recordReceipt(harness: Harness, requestId: string, outcome: AdmissionOutcome): void {
  if (!outcome.admitted) return;
  const first = harness.receiptsByRequest.get(requestId);
  if (first === undefined) harness.receiptsByRequest.set(requestId, outcome.receipt.id);
  else if (first !== outcome.receipt.id) {
    violation(harness, `replay of ${requestId} returned receipt ${outcome.receipt.id}, first was ${first}`);
  }
}

function step(harness: Harness, op: OpName): void {
  const worker = pick(harness.random, harness.workers);
  const at = now(harness);
  const log = (message: string) => harness.timeline.push(`t+${harness.clock}ms ${message}`);

  switch (op) {
    case "issue": {
      const actionKey = pick(harness.random, ACTIONS);
      const provider = pick(harness.random, PROVIDERS);
      worker.counter += 1;
      const requestId = `${worker.name}-${actionKey.replace("/", "-")}-${worker.counter}`;
      const policyBefore = readProductionPolicy(harness.operator);
      const outcome = issueAdmission(worker.db, {
        requestId,
        actionKey,
        projectSlug: "demo",
        planSlug: "queue-plan",
        provider,
        expectedEpoch: worker.cachedEpoch,
        capacity: capacityFor(provider, harness.capacity),
        now: at
      });
      log(`${worker.name} issue ${requestId} ${provider} cap=${harness.capacity} epoch=${worker.cachedEpoch} -> ${outcome.admitted ? "admitted" : outcome.code}`);
      recordReceipt(harness, requestId, outcome);
      if (outcome.admitted) {
        if (harness.capacity !== "fresh") violation(harness, `admitted ${requestId} on ${harness.capacity} capacity`);
        if (policyBefore.desiredState !== "active") violation(harness, `admitted ${requestId} while Inactive`);
        const scope = policyBefore.scope!;
        if (scope.actions.length && !scope.actions.includes(actionKey)) violation(harness, `admitted ${actionKey} outside scope`);
        if (!scope.providers.includes(provider)) violation(harness, `admitted unpermitted provider ${provider}`);
        if (worker.cachedEpoch !== undefined && worker.cachedEpoch !== policyBefore.epoch) {
          violation(harness, `admitted ${requestId} for stale epoch ${worker.cachedEpoch} (current ${policyBefore.epoch})`);
        }
        worker.pending.push({ requestId, actionKey, provider, receiptId: outcome.receipt.id, claimGeneration: null, committed: false });
      } else if (outcome.code === "stale_epoch" || outcome.code === "production_inactive") {
        // A refused worker re-reads before its next tick, like the real worker loop.
        worker.cachedEpoch = undefined;
      }
      return;
    }
    case "retry": {
      // Lost response: replay a request id the worker (or its crashed predecessor) issued.
      const known = [...harness.receiptsByRequest.keys()].filter((id) => id.startsWith(worker.name));
      if (!known.length) return;
      const requestId = pick(harness.random, known);
      const actionKey = ACTIONS.find((key) => requestId.includes(key.replace("/", "-")))!;
      const provider = pick(harness.random, PROVIDERS);
      const outcome = issueAdmission(worker.db, {
        requestId, actionKey, projectSlug: "demo", planSlug: "queue-plan", provider,
        capacity: capacityFor(provider, harness.capacity), now: at
      });
      log(`${worker.name} retry ${requestId} -> ${outcome.admitted ? `admitted ${outcome.receipt.status}` : outcome.code}`);
      recordReceipt(harness, requestId, outcome);
      if (outcome.admitted && !worker.pending.some((p) => p.requestId === requestId)) {
        worker.pending.push({
          requestId, actionKey, provider: outcome.receipt.provider, receiptId: outcome.receipt.id,
          claimGeneration: null, committed: outcome.receipt.status === "committed"
        });
      }
      return;
    }
    case "claim": {
      const target = worker.pending.find((p) => !p.claimGeneration);
      if (!target) return;
      const actionId = target.actionKey.split("/")[1];
      try {
        const reservation = reserveAgentWorktree(worker.db, {
          repositoryPath: REPO,
          worktreePath: `${REPO}-worktrees/${worker.name}-${target.requestId}`,
          branch: `${worker.name}/${target.requestId}`,
          now: at,
          project: "demo",
          actionId
        });
        target.claimGeneration = reservation.claim_generation;
        log(`${worker.name} claim ${target.actionKey} for ${target.requestId} -> held`);
      } catch (error) {
        log(`${worker.name} claim ${target.actionKey} for ${target.requestId} -> refused (${(error as Error).message.slice(0, 60)})`);
        releaseAdmission(worker.db, target.requestId, at);
        worker.pending = worker.pending.filter((p) => p !== target);
      }
      return;
    }
    case "commit": {
      const target = worker.pending.find((p) => p.claimGeneration && !p.committed);
      if (!target) return;
      const policyBefore = readProductionPolicy(harness.operator);
      const outcome = commitAdmission(worker.db, target.requestId, at);
      log(`${worker.name} commit ${target.requestId} -> ${outcome.admitted ? "committed" : outcome.code}`);
      if (outcome.admitted) {
        if (policyBefore.desiredState !== "active") violation(harness, `committed ${target.requestId} while Inactive`);
        if (outcome.receipt.epoch !== policyBefore.epoch) {
          violation(harness, `committed ${target.requestId} from epoch ${outcome.receipt.epoch} under epoch ${policyBefore.epoch}`);
        }
        target.committed = true;
      } else {
        // Abandon the unlaunched candidate exactly as launchGuardedHostSession does.
        releaseActionClaim(worker.db, { repositoryPath: REPO, project: "demo", actionId: target.actionKey.split("/")[1], generation: target.claimGeneration! });
        worker.pending = worker.pending.filter((p) => p !== target);
      }
      return;
    }
    case "finish": {
      const target = worker.pending.find((p) => p.committed);
      if (!target) return;
      releaseAdmission(worker.db, target.requestId, at);
      releaseActionClaim(worker.db, { repositoryPath: REPO, project: "demo", actionId: target.actionKey.split("/")[1], generation: target.claimGeneration! });
      worker.pending = worker.pending.filter((p) => p !== target);
      log(`${worker.name} finish ${target.requestId}`);
      return;
    }
    case "crash": {
      // A crash forgets in-memory state. Durable rows remain; issued ones expire
      // or are fenced, committed ones stay live until reconciled.
      log(`${worker.name} crash (forgets ${worker.pending.length} pending, epoch ${worker.cachedEpoch})`);
      worker.pending = worker.pending.filter((p) => p.committed);
      worker.cachedEpoch = undefined;
      return;
    }
    case "refresh-epoch": {
      worker.cachedEpoch = readProductionPolicy(worker.db).epoch;
      log(`${worker.name} observes epoch ${worker.cachedEpoch}`);
      return;
    }
    case "off": {
      const result = deactivateProduction(harness.operator, { requestId: `${harness.scenario}-${harness.seed}-off-${harness.timeline.length}`, now: at });
      log(`operator Off -> fenced ${result.fenced.length}, committed ${result.committed.length}`);
      const issued = harness.operator.prepare("SELECT COUNT(*) AS n FROM production_admissions WHERE status = 'issued'").get() as { n: number };
      if (issued.n !== 0) violation(harness, `Off left ${issued.n} issued admissions unfenced`);
      return;
    }
    case "on":
    case "rescope": {
      grant(harness);
      log(`operator ${op} -> epoch ${readProductionPolicy(harness.operator).epoch}`);
      return;
    }
    case "tick-clock": {
      harness.clock += Math.floor(harness.random() * 40_000);
      log(`clock advances`);
      return;
    }
    case "capacity": {
      harness.capacity = pick(harness.random, ["fresh", "fresh", "refused", "unknown", "mismatched"] as const);
      log(`capacity -> ${harness.capacity}`);
      return;
    }
  }
}

function violation(harness: Harness, message: string): never {
  const evidence = { scenario: harness.scenario, seed: harness.seed, violation: message, timeline: harness.timeline };
  const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `violation-${harness.scenario}-${harness.seed}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  throw new Error(`Invariant violated [${harness.scenario} seed ${harness.seed}]: ${message}\n${harness.timeline.join("\n")}`);
}

/** Invariants that must hold after every step, read from the database itself. */
function checkInvariants(harness: Harness): void {
  const db = harness.operator;
  const at = now(harness).toISOString();

  // At most one live execution per Action: no two committed admissions for one
  // Action are live at once, and the claim table never holds two live claims.
  const duplicateCommitted = db.prepare(`SELECT action_key, COUNT(*) AS n FROM production_admissions
    WHERE status = 'committed' GROUP BY action_key HAVING n > 1`).all() as Array<{ action_key: string; n: number }>;
  if (duplicateCommitted.length) violation(harness, `duplicate live execution: ${JSON.stringify(duplicateCommitted)}`);
  const duplicateClaims = db.prepare(`SELECT action_id, COUNT(*) AS n FROM agent_worktree_reservations
    WHERE action_id IS NOT NULL AND expires_at > ? GROUP BY repository_path, project, action_id HAVING n > 1`).all(at);
  if (duplicateClaims.length) violation(harness, `duplicate live claim: ${JSON.stringify(duplicateClaims)}`);

  // A worker's belief that it is running must be backed by durable state.
  for (const worker of harness.workers) {
    for (const pending of worker.pending.filter((p) => p.committed)) {
      const row = db.prepare("SELECT status FROM production_admissions WHERE request_id = ?").get(pending.requestId) as { status: string } | undefined;
      if (row?.status !== "committed") violation(harness, `${worker.name} runs ${pending.requestId} but its admission is ${row?.status ?? "missing"}`);
    }
  }

  // Concurrency never exceeds the authorized bound.
  const policy = readProductionPolicy(db);
  const live = db.prepare(`SELECT COUNT(*) AS n FROM production_admissions
    WHERE status = 'committed' OR (status = 'issued' AND epoch = ? AND expires_at > ?)`).get(policy.epoch, at) as { n: number };
  if (live.n > harness.maxConcurrent) violation(harness, `${live.n} live admissions exceed concurrency ${harness.maxConcurrent}`);

  // Inactive holds no redeemable reservation.
  if (policy.desiredState === "inactive") {
    const issued = db.prepare("SELECT COUNT(*) AS n FROM production_admissions WHERE status = 'issued'").get() as { n: number };
    if (issued.n) violation(harness, `${issued.n} issued admissions survive while Inactive`);
  }

  // One request id, one row: idempotency is enforced durably, not only in memory.
  const duplicateRequests = db.prepare(`SELECT request_id FROM production_admissions GROUP BY request_id HAVING COUNT(*) > 1`).all();
  if (duplicateRequests.length) violation(harness, `duplicate admission rows: ${JSON.stringify(duplicateRequests)}`);
}

function runScenario(scenario: string, seed: number): { steps: number; admitted: number; committed: number; fenced: number } {
  const target = workspace();
  const random = rng(seed);
  const operator = openDatabase(target);
  const workers: Worker[] = ["worker-a", "worker-b"].map((name) => ({
    name, db: openDatabase(target), cachedEpoch: undefined, pending: [], counter: 0
  }));
  const harness: Harness = {
    scenario, seed, random, operator, workers, clock: 0, capacity: "fresh",
    maxConcurrent: 1 + Math.floor(random() * 2), receiptsByRequest: new Map(), timeline: [], grants: 0
  };
  try {
    grant(harness);
    for (let index = 0; index < STEPS_PER_RUN; index += 1) {
      step(harness, weightedOp(random, SCENARIOS[scenario]));
      checkInvariants(harness);
    }
    const counts = operator.prepare(`SELECT
        COUNT(*) AS admitted,
        SUM(CASE WHEN committed_at IS NOT NULL THEN 1 ELSE 0 END) AS committed,
        SUM(CASE WHEN status = 'fenced' THEN 1 ELSE 0 END) AS fenced
      FROM production_admissions`).get() as { admitted: number; committed: number | null; fenced: number | null };
    return { steps: STEPS_PER_RUN, admitted: counts.admitted, committed: counts.committed ?? 0, fenced: counts.fenced ?? 0 };
  } finally {
    for (const worker of workers) worker.db.close();
    operator.close();
  }
}

describe("contract-20 fault matrix (policy and claim store)", () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    it(`${scenario}: ${SEEDS_PER_SCENARIO} seeded interleavings hold every invariant`, () => {
      const totals = { steps: 0, admitted: 0, committed: 0, fenced: 0 };
      for (let seed = 1; seed <= SEEDS_PER_SCENARIO; seed += 1) {
        const result = runScenario(scenario, seed);
        totals.steps += result.steps;
        totals.admitted += result.admitted;
        totals.committed += result.committed;
        totals.fenced += result.fenced;
      }
      // Guard against a vacuous pass: the scenario must actually exercise the
      // paths it names, not refuse everything.
      expect(totals.committed).toBeGreaterThan(0);
      if (scenario === "off" || scenario === "priority-authority") expect(totals.fenced).toBeGreaterThan(0);
      const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `summary-${scenario}.json`), `${JSON.stringify({ scenario, seeds: SEEDS_PER_SCENARIO, violations: 0, ...totals }, null, 2)}\n`);
      }
    }, 120_000);
  }
});
