import { openDatabase, writeTransaction } from "../../src/db/connection.js";
import type { CapacityAdmissionDecision } from "../../src/codingAgents/capacity.js";
import { commitAdmission, issueAdmission, releaseAdmission } from "../../src/production/policy.js";
import { releaseActionClaim, releaseWorktreeReservation, reserveAgentWorktree } from "../../src/sessions/index.js";

/**
 * One writer process for `tests/db-contention.test.ts`. It opens its own
 * connection through `openDatabase` -- the production `busy_timeout` and WAL
 * settings, not test-tuned ones -- and loops the three write shapes the
 * managed-production path performs, then prints one JSON line of measurements.
 *
 * `issueAdmission`/`commitAdmission`/`releaseAdmission` open their own
 * `writeTransaction`, so their lock wait cannot be split from their hold time
 * from outside; their end-to-end latency is recorded instead, which is an
 * upper bound on the wait. The settlement-sized transaction is instrumented
 * from inside, so its wait and hold are exact.
 */
interface WorkerConfig {
  workspace: string;
  worker: number;
  iterations: number;
  repositoryPath: string;
  settlementRows: number;
}

const config = JSON.parse(process.argv[2]) as WorkerConfig;
const db = openDatabase(config.workspace);

const capacity: CapacityAdmissionDecision = {
  providerId: "claude",
  admitted: true,
  code: null,
  reason: "load-test fixture",
  unattendedProof: true,
  retryAfter: null,
  refreshRequired: false,
  receipt: {} as CapacityAdmissionDecision["receipt"]
};

const result = {
  worker: config.worker,
  operations: 0,
  busyErrors: 0,
  otherErrors: [] as string[],
  longestOperationMs: 0,
  longestSettlementWaitMs: 0,
  longestSettlementHoldMs: 0
};

function measure<T>(operation: () => T): T | undefined {
  const started = performance.now();
  try {
    return operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/SQLITE_BUSY|database is locked/i.test(message)) result.busyErrors += 1;
    else result.otherErrors.push(message);
    return undefined;
  } finally {
    result.operations += 1;
    result.longestOperationMs = Math.max(result.longestOperationMs, performance.now() - started);
  }
}

db.exec("CREATE TABLE IF NOT EXISTS load_test_settlement (id INTEGER PRIMARY KEY, worker INTEGER, note TEXT)");

for (let i = 0; i < config.iterations; i += 1) {
  const key = `w${config.worker}-i${i}`;

  // 1. Production admission: issue, commit, release.
  const issued = measure(() => issueAdmission(db, {
    requestId: `load-${key}`,
    actionKey: `demo/${key}`,
    projectSlug: "demo",
    planSlug: "load-plan",
    provider: "claude",
    capacity
  }));
  if (issued && !issued.admitted) result.otherErrors.push(`admission refused: ${issued.code}`);
  if (issued?.admitted) {
    measure(() => commitAdmission(db, `load-${key}`));
    measure(() => releaseAdmission(db, `load-${key}`));
  }

  // 2. Action claim: reserve, release the claim, then drop the reservation.
  const worktreePath = `${config.repositoryPath}/.load/${key}`;
  const reservation = measure(() => reserveAgentWorktree(db, {
    repositoryPath: config.repositoryPath,
    worktreePath,
    branch: `load/${key}`,
    now: new Date(),
    project: "demo",
    actionId: key
  }));
  if (reservation) {
    measure(() => releaseActionClaim(db, {
      repositoryPath: config.repositoryPath,
      project: "demo",
      actionId: key,
      generation: reservation.claim_generation!
    }));
    measure(() => releaseWorktreeReservation(db, config.repositoryPath, worktreePath));
  }

  // 3. A settlement-sized write: read, then many rows in one transaction.
  const called = performance.now();
  measure(() => writeTransaction(db, () => {
    const entered = performance.now();
    result.longestSettlementWaitMs = Math.max(result.longestSettlementWaitMs, entered - called);
    db.prepare("SELECT count(*) AS n FROM load_test_settlement").get();
    const insert = db.prepare("INSERT INTO load_test_settlement (worker, note) VALUES (?, ?)");
    for (let row = 0; row < config.settlementRows; row += 1) insert.run(config.worker, `${key}-${row}`);
    result.longestSettlementHoldMs = Math.max(result.longestSettlementHoldMs, performance.now() - entered);
  }));
}

db.close();
process.stdout.write(`${JSON.stringify(result)}\n`);
