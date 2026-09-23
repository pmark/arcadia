import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import { runWorktreeRuntimeProbe, type WorktreeRuntimeProbeStep } from "../src/sessions/worktreeRuntimeProbe.js";

/**
 * Contract 20's deterministic fault matrix, runtime boundary: the host
 * candidate-build probe (`runWorktreeRuntimeProbe`) that
 * `arcadia go-broker install` runs before trusting a new broker revision, and
 * that stands in for "candidate-build, controller-upgrade-failure,
 * schema-incompatibility" in the evidence index's boundary table.
 *
 * This does not fit the two-SQLite-worker transaction harness the other
 * scenarios use: it is a filesystem-and-subprocess installation flow, run
 * once per host upgrade, not a repeated concurrent per-request store call
 * (see the exploration this Action ran: `runWorktreeRuntimeProbe` has no
 * database, no concurrent callers, and no natural transaction boundary). The
 * seeded-interleaving contract still applies at the grain this boundary
 * actually has: which of its named steps fails, and whether cleanup ran
 * regardless. Each seed deterministically injects a failure at one step (or
 * none, as the seeded control) through the probe's own dependency-injected
 * `run` -- the same seam `tests/runtime-pinning.test.ts` and production both
 * already trust -- so every run is a real call to `runWorktreeRuntimeProbe`,
 * not a mock of it. No git, pnpm, tsc, or vitest subprocess actually runs;
 * the injected `run` simulates only the two steps that touch the filesystem
 * (`git worktree add`/`remove`) so later probe steps see the directory shape
 * they expect, and is a no-op for the rest.
 *
 * Two steps this probe has -- `candidate-root-write` and `source-write` --
 * write files directly, not through `run`, so they are out of this harness's
 * injection seam; ordinary Node `fs` failure semantics govern them uniformly,
 * and the try/catch shape wrapping every step (`probe()` in
 * `src/sessions/worktreeRuntimeProbe.ts`) is identical regardless of which
 * step throws, so the 7 injectable steps give strong structural evidence
 * for the other 2.
 *
 * `validateExistingRelease`/`inspectInstalledBroker` (schema/manifest
 * mismatch) are module-private to `src/commands/goBrokerInstall.ts` and
 * exercised only through the full `arcadia go-broker install` flow, which
 * stages a real release tree; that is out of scope for this seeded matrix
 * and remains covered by `tests/go-broker-agent-setup.test.ts`.
 */

const SEEDS_PER_SCENARIO = 100;

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

/** The steps `runWorktreeRuntimeProbe` drives through its `run` seam, in the
 * order the probe itself declares them. `candidate-root-write`/`source-write`
 * are plain `fs` writes, not `run` calls -- see the file doc comment. */
const INJECTABLE_STEPS: readonly WorktreeRuntimeProbeStep[] = [
  "candidate-worktree", "dependency-preparation", "temporary-sqlite",
  "candidate-build", "dashboard-build", "vitest", "compiled-broker"
];

type Classified = WorktreeRuntimeProbeStep | "cleanup" | "unknown";

function classify(command: string, args: string[]): Classified {
  if (command === "git" && args[0] === "worktree" && args[1] === "add") return "candidate-worktree";
  if (command === "git" && args[0] === "worktree" && args[1] === "remove") return "cleanup";
  if (command === "pnpm" && args[0] === "bridge:worktree") return "dependency-preparation";
  if (command === "pnpm" && args[0] === "exec" && args[1] === "tsc") return "candidate-build";
  if (command === "pnpm" && args[0] === "dashboard:build") return "dashboard-build";
  if (command === "pnpm" && args[0] === "vitest") return "vitest";
  if (args.includes("--eval")) return "temporary-sqlite";
  if (args.includes("--check")) return "compiled-broker";
  return "unknown";
}

/** A fake `run` that never shells out: it simulates only the two filesystem
 * effects later steps depend on (the candidate directory existing, and it
 * being gone after cleanup), throws at exactly the injected step, and
 * records every call for the harness's own invariants. */
function fakeRun(options: {
  failAt: WorktreeRuntimeProbeStep | null;
  failCleanup: boolean;
  calls: string[];
}): (command: string, args: string[], cwd: string) => void {
  return (command, args) => {
    const kind = classify(command, args);
    options.calls.push(kind);
    if (kind === "cleanup") {
      if (options.failCleanup) throw new Error("simulated cleanup failure");
      rmSync(args[3], { recursive: true, force: true });
      return;
    }
    if (kind === options.failAt) throw new Error(`simulated failure at ${kind}`);
    if (kind === "candidate-worktree") mkdirSync(args[3], { recursive: true });
  };
}

interface ScenarioResult {
  checkedSteps: number;
  failed: boolean;
}

function violation(seed: number, message: string, extra: Record<string, unknown> = {}): never {
  const evidence = { scenario: "runtime", seed, violation: message, ...extra };
  const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `violation-runtime-${seed}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  throw new Error(`Invariant violated [runtime seed ${seed}]: ${message}\n${JSON.stringify(extra)}`);
}

function runScenario(seed: number): ScenarioResult {
  const random = rng(seed);
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-fault-matrix-runtime-"));
  temporary.push(root);
  const home = path.join(root, "home");
  const repository = path.join(root, "repo");
  mkdirSync(home, { recursive: true });
  mkdirSync(repository, { recursive: true });

  const failAt = pick(random, [...INJECTABLE_STEPS, null] as const);
  const failCleanup = failAt !== null && failAt !== "candidate-worktree" && random() < 0.2;
  const calls: string[] = [];
  const run = fakeRun({ failAt, failCleanup, calls });

  let thrown: unknown = null;
  let result: ReturnType<typeof runWorktreeRuntimeProbe> | null = null;
  try {
    result = runWorktreeRuntimeProbe({
      repository, brokerEntrypoint: path.join(root, "broker.js"),
      home, now: new Date("2026-09-23T00:00:00.000Z"), run
    });
  } catch (error) {
    thrown = error;
  }

  if (failAt === null) {
    if (thrown) violation(seed, "the no-fault control run threw", { thrown: thrown instanceof Error ? thrown.message : String(thrown) });
    if (result?.checked.length !== 9) violation(seed, `expected all 9 steps checked, got ${result?.checked.length}`, { checked: result?.checked });
  } else {
    if (!thrown) violation(seed, `expected a failure at ${failAt} but the probe succeeded`);
    if (!(thrown instanceof ArcadiaError)) violation(seed, "thrown error was not an ArcadiaError", { thrown: String(thrown) });
    else if (!failCleanup && thrown.details.step !== failAt) {
      violation(seed, `error named the wrong step`, { expected: failAt, actual: thrown.details.step });
    } else if (failCleanup && thrown.details.step !== "candidate-worktree") {
      // A cleanup failure is itself reported as a `candidate-worktree` error
      // (retireCandidate's own catch), replacing whatever error triggered it.
      violation(seed, `cleanup failure was not reported as candidate-worktree`, { actual: thrown.details.step });
    }
  }

  // Cleanup (the `git worktree remove` call) must run whenever the candidate
  // was actually created -- every failAt except the worktree-add step itself
  // -- and must never run when it was not.
  const cleanupAttempted = calls.includes("cleanup");
  const candidateWasCreated = failAt !== "candidate-worktree";
  if (candidateWasCreated && !cleanupAttempted) {
    violation(seed, "cleanup (git worktree remove) was never attempted for a created candidate", { failAt, calls });
  }
  if (!candidateWasCreated && cleanupAttempted) {
    violation(seed, "cleanup ran even though the candidate worktree was never created", { calls });
  }

  return { checkedSteps: result?.checked.length ?? 0, failed: thrown !== null };
}

describe("contract-20 fault matrix (runtime)", () => {
  it(`runtime: ${SEEDS_PER_SCENARIO} seeded candidate-build interleavings hold every invariant`, () => {
    let failures = 0;
    let successes = 0;
    for (let seed = 1; seed <= SEEDS_PER_SCENARIO; seed += 1) {
      const result = runScenario(seed);
      if (result.failed) failures += 1; else successes += 1;
    }
    // Guard against a vacuous pass: both the failure-injection path and the
    // clean-success path must actually have run.
    expect(failures).toBeGreaterThan(0);
    expect(successes).toBeGreaterThan(0);
    const dir = process.env.ARCADIA_FAULT_MATRIX_EVIDENCE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "summary-runtime.json"), `${JSON.stringify({ scenario: "runtime", seeds: SEEDS_PER_SCENARIO, violations: 0, failures, successes }, null, 2)}\n`);
    }
  }, 60_000);
});
