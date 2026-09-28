import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import {
  CONCURRENT_READY_SET_ADMISSION_PROOF_REF,
  activateProduction,
  fingerprintProductionScope,
  normalizeProductionScope
} from "../src/production/policy.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { tsxLoader } from "./cli-response-fixture.js";

/**
 * Load test behind the tested basis for `maxConcurrentSessions`
 * (`docs/production-scheduling.md`, "Workspace database concurrency"). Separate
 * OS processes -- not threads, not one shared connection -- run the write paths
 * managed production performs against one WAL database, so contention is the
 * real thing: file locks, not a JavaScript event loop.
 *
 * Scale it with `ARCADIA_DB_LOAD_WRITERS` / `ARCADIA_DB_LOAD_ITERATIONS`, and
 * set `ARCADIA_DB_LOAD_REPORT` to a file path to append each run's measurements
 * as a JSON line (vitest does not surface console output from passing tests).
 */
const WRITERS = Number(process.env.ARCADIA_DB_LOAD_WRITERS ?? 8);
const ITERATIONS = Number(process.env.ARCADIA_DB_LOAD_ITERATIONS ?? 40);
const SETTLEMENT_ROWS = 40;

interface WorkerReport {
  worker: number;
  operations: number;
  busyErrors: number;
  otherErrors: string[];
  longestOperationMs: number;
  longestSettlementWaitMs: number;
  longestSettlementHoldMs: number;
}

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runWorker(config: Record<string, unknown>): Promise<WorkerReport> {
  const worker = path.join(import.meta.dirname, "support", "db-contention-worker.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, worker, JSON.stringify(config)], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const line = stdout.trim().split("\n").at(-1) ?? "";
      if (code !== 0 || !line) return reject(new Error(`worker exited ${code}: ${stderr}`));
      resolve(JSON.parse(line) as WorkerReport);
    });
  });
}

describe("workspace database under concurrent writer processes", () => {
  it(`${WRITERS} processes issue/commit/release admissions, claim Actions, and settle with no surfaced SQLITE_BUSY`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-db-load-"));
    temporary.push(root);
    const workspace = path.join(root, "workspace");
    initWorkspace(workspace);

    const busyTimeoutMs = withDatabase(workspace, (db) => db.pragma("busy_timeout", { simple: true }) as number);
    expect(busyTimeoutMs).toBeGreaterThan(0);

    // maxConcurrentSessions equals the writer count and the rehearsal exception
    // lifts the gate, so every worker is admitted and the commit/release paths
    // run rather than being refused at the cap.
    const scope = normalizeProductionScope({
      intent: "Load-test the workspace database.",
      projects: ["demo"],
      plans: ["demo/load-plan"],
      actions: [],
      providers: ["claude"],
      maxConcurrentSessions: WRITERS,
      mechanicalTransitions: ["validation", "acceptance", "pointer"],
      rehearsalException: {
        actionRef: CONCURRENT_READY_SET_ADMISSION_PROOF_REF,
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()
      }
    });
    withDatabase(workspace, (db) => activateProduction(db, {
      requestId: "load-grant",
      scope,
      scopeFingerprint: fingerprintProductionScope(scope),
      grantedBy: "operator"
    }));

    const started = performance.now();
    const reports = await Promise.all(Array.from({ length: WRITERS }, (_, worker) => runWorker({
      workspace,
      worker,
      iterations: ITERATIONS,
      repositoryPath: path.join(root, "repo"),
      settlementRows: SETTLEMENT_ROWS
    })));
    const elapsedMs = performance.now() - started;

    const summary = {
      writers: WRITERS,
      iterationsPerWriter: ITERATIONS,
      operations: reports.reduce((sum, r) => sum + r.operations, 0),
      elapsedMs: Math.round(elapsedMs),
      busyTimeoutMs,
      surfacedBusyErrors: reports.reduce((sum, r) => sum + r.busyErrors, 0),
      otherErrors: reports.flatMap((r) => r.otherErrors),
      longestOperationMs: Math.max(...reports.map((r) => r.longestOperationMs)),
      longestSettlementWaitMs: Math.max(...reports.map((r) => r.longestSettlementWaitMs)),
      longestSettlementHoldMs: Math.max(...reports.map((r) => r.longestSettlementHoldMs))
    };
    console.info(`db-contention ${JSON.stringify(summary)}`);
    if (process.env.ARCADIA_DB_LOAD_REPORT) appendFileSync(process.env.ARCADIA_DB_LOAD_REPORT, `${JSON.stringify(summary)}\n`);

    expect(summary.otherErrors).toEqual([]);
    expect(summary.surfacedBusyErrors).toBe(0);
    // The end-to-end operation latency bounds every lock wait from above.
    expect(summary.longestOperationMs).toBeLessThan(busyTimeoutMs);
    expect(summary.longestSettlementWaitMs).toBeLessThan(busyTimeoutMs);

    const db = openDatabase(workspace);
    try {
      const rows = (db.prepare("SELECT count(*) AS n FROM load_test_settlement").get() as { n: number }).n;
      expect(rows).toBe(WRITERS * ITERATIONS * SETTLEMENT_ROWS);
      const live = (db.prepare("SELECT count(*) AS n FROM production_admissions WHERE status != 'released'").get() as { n: number }).n;
      expect(live).toBe(0);
    } finally {
      db.close();
    }
  }, 180_000);
});
