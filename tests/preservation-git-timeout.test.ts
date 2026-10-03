import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureGit, manualPreservationFixture } from "../scripts/preservation-fixture.js";
import { withDatabase } from "../src/db/connection.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { runPreserveCommand } from "../src/commands/preserve.js";
import { bindManualPreservation, manualPreservationRequestId } from "../src/sessions/manualPreservation.js";
import { materializeCandidateTree, snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { getPreservationRefusalAttempts, MAX_IDENTICAL_PRESERVATION_REFUSALS } from "../src/sessions/preservationRefusalBudget.js";
import {
  PRESERVATION_GIT_TIMEOUT_MS, PRESERVATION_STAGE_TIMEOUT_MS, preservationGitTimeoutMs, preservationProcessLimits,
  preservationStage, withPreservationProgress
} from "../src/sessions/preservationStages.js";
import * as validation from "../src/sessions/preservationValidation.js";

// A per-call bound short enough to keep the suite fast, long enough that an
// unhung Git call under load never trips it.
const GIT_TIMEOUT_MS = 2_000;
const BRANCH = "codex/preservation-fixture";
const fixtures: ReturnType<typeof manualPreservationFixture>[] = [];

/** A PATH `git` that hangs only while the reported stage (and optional argument)
 * matches, so each test can stall exactly one bounded call at one stage. */
function hungGitShim(root: string) {
  const realGit = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = path.join(root, "hung-git-bin");
  mkdirSync(bin);
  const stageFile = path.join(root, "current-stage");
  writeFileSync(path.join(bin, "git"), `#!/bin/sh
if [ -n "$ARCADIA_TEST_HANG_STAGE" ] && [ "$(cat '${stageFile}' 2>/dev/null)" = "$ARCADIA_TEST_HANG_STAGE" ]; then
  if [ -z "$ARCADIA_TEST_HANG_ARG" ]; then exec sleep 30; fi
  for arg in "$@"; do [ "$arg" = "$ARCADIA_TEST_HANG_ARG" ] && exec sleep 30; done
fi
exec '${realGit}' "$@"
`);
  chmodSync(path.join(bin, "git"), 0o755);
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  return stageFile;
}

function setup(options: { advanceBase?: boolean } = {}) {
  const f = manualPreservationFixture(); fixtures.push(f);
  // A tracked modification (` M`) and an untracked file (`??`): the shapes the
  // old real-index `read-tree` silently turned into staged changes.
  appendFileSync(path.join(f.candidate, "check.mjs"), "// candidate edit\n");
  const binding = withDatabase(f.workspace, db => bindManualPreservation(db, {
    repository: f.repo, worktree: f.candidate, baseBranch: "main", projectSlug: "preservation-fixture"
  }));
  if (options.advanceBase) {
    writeFileSync(path.join(f.repo, "unrelated.txt"), "advanced base\n");
    fixtureGit(f.repo, ["add", "unrelated.txt"]);
    fixtureGit(f.repo, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "advance base cleanly"]);
  }
  const gitDir = fixtureGit(f.candidate, ["rev-parse", "--absolute-git-dir"]);
  const stageFile = hungGitShim(f.root);
  const observe = () => ({
    index: readFileSync(path.join(gitDir, "index")).toString("base64"),
    // Untrimmed: the leading column distinguishes ` M` (unstaged) from `M ` (staged).
    status: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: f.candidate, encoding: "utf8" }),
    lock: existsSync(path.join(gitDir, "index.lock")),
    ahead: fixtureGit(f.candidate, ["rev-list", "--count", `${f.base}..${BRANCH}`])
  });
  const preserve = () => withPreservationProgress(stage => writeFileSync(stageFile, stage),
    () => runPreserveCommand({ source: f.candidate, workspace: f.workspace }), { gitTimeoutMs: GIT_TIMEOUT_MS });
  const timeoutAt = (stage: string, arg?: string) => {
    vi.stubEnv("ARCADIA_TEST_HANG_STAGE", stage);
    vi.stubEnv("ARCADIA_TEST_HANG_ARG", arg ?? "");
    try { preserve(); } catch (error) { return error as ArcadiaError; } finally {
      vi.stubEnv("ARCADIA_TEST_HANG_STAGE", "");
    }
    throw new Error(`No timeout surfaced at ${stage} ${arg ?? ""}`);
  };
  return { f, binding, observe, preserve, timeoutAt };
}

function expectTypedTimeout(error: ArcadiaError, stage: string, subcommand?: string) {
  expect(error).toBeInstanceOf(ArcadiaError);
  expect(error.code).toBe("PRESERVATION_GIT_TIMEOUT");
  expect(error.message).not.toMatch(/could not be resolved|not a forward advance|Unexpected error|ETIMEDOUT|capture refused/i);
  expect(error.details).toMatchObject({
    retryable: true, command: "git", stage, timeoutMs: GIT_TIMEOUT_MS,
    gitSubcommand: subcommand ?? expect.any(String), args: expect.any(Array), cwd: expect.any(String),
    remedy: expect.stringContaining("Retry the same fixed protected launcher")
  });
  expect(error.details.identicalRefusalLimitReached).toBeUndefined();
}

beforeEach(() => {
  vi.stubEnv("CODEX_SANDBOX", "");
  // Seatbelt validation is proven by the gated host suite; this mirrors its
  // stage sequence and real Git calls so each stage can be stalled here.
  vi.spyOn(validation, "validateBoundCandidate").mockImplementation((_workspace, candidate, binding, assertBinding) => {
    preservationStage("validation.binding");
    assertBinding();
    preservationStage("validation.snapshot");
    const tree = snapshotCandidate(candidate.worktree);
    preservationStage("validation.materialize");
    const scratch = mkdtempSync(path.join(path.dirname(candidate.worktree), "arcadia-materialize-"));
    try { materializeCandidateTree(candidate.worktree, tree, scratch); } finally { rmSync(scratch, { recursive: true, force: true }); }
    preservationStage("validation.recheck-binding");
    assertBinding();
    preservationStage("validation.recheck-snapshot");
    if (snapshotCandidate(candidate.worktree) !== tree) throw new Error("candidate changed");
    return { passed: true, evidenceRef: "fixture-validation-only", candidateFingerprint: tree, binding };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    rmSync(f.candidate, { recursive: true, force: true }); rmSync(f.root, { recursive: true, force: true });
  }
});

describe("preservation git timeouts", () => {
  it("defaults the per-call bound below the stage idle limit and accepts only a bounded override", () => {
    expect(PRESERVATION_GIT_TIMEOUT_MS).toBeLessThan(PRESERVATION_STAGE_TIMEOUT_MS);
    expect(preservationGitTimeoutMs({})).toBe(PRESERVATION_GIT_TIMEOUT_MS);
    expect(preservationGitTimeoutMs({ ARCADIA_PRESERVATION_GIT_TIMEOUT_MS: "45000" })).toBe(45_000);
    for (const ignored of ["150000", "900000", "0", "-1", "1.5", "slow"]) {
      expect(preservationGitTimeoutMs({ ARCADIA_PRESERVATION_GIT_TIMEOUT_MS: ignored })).toBe(PRESERVATION_GIT_TIMEOUT_MS);
    }
    vi.stubEnv("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS", "45000");
    expect(withPreservationProgress(() => undefined, () => preservationProcessLimits())).toEqual({ timeout: 45_000, killSignal: "SIGKILL" });
    expect(preservationProcessLimits()).toEqual({});
  });

  it("heartbeats the current stage between bounded snapshot calls", () => {
    const f = manualPreservationFixture(); fixtures.push(f);
    for (let index = 0; index < 20; index += 1) writeFileSync(path.join(f.candidate, `file-${index}.txt`), `${index}\n`);
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 1_000));
    const events: Array<{ stage: string; at: number; heartbeat: boolean }> = [];
    withPreservationProgress((stage, details) => events.push({ stage, at: clock, heartbeat: details?.heartbeat === true }), () => {
      preservationStage("preserve.snapshot");
      snapshotCandidate(f.candidate);
    });
    const heartbeats = events.filter(event => event.heartbeat);
    expect(heartbeats.length).toBeGreaterThanOrEqual(3);
    expect(heartbeats.every(event => event.stage === "preserve.snapshot")).toBe(true);
    // Each snapshot call advanced the fake clock 1s; no gap reaches the 5s
    // throttle plus one call, far inside the 150s stage watchdog.
    const gaps = events.slice(1).map((event, index) => event.at - events[index].at);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(6_000);
  });

  it("stalls one call at every stage before the commit with a typed retryable error and an untouched candidate", () => {
    const { f, binding, observe, preserve, timeoutAt } = setup();
    const before = observe();
    expect(before.status).toContain(" M check.mjs");
    expect(before.status).toContain("?? marker.txt");
    const stalls: Array<[stage: string, arg?: string]> = [
      ["binding.resolve"], ["binding.manual"],
      ["validation.binding"], ["validation.snapshot"], ["validation.snapshot", "hash-object"], ["validation.materialize", "cat-file"],
      ["validation.recheck-binding"], ["validation.recheck-snapshot"],
      ["preserve.preconditions"], ["preserve.snapshot"], ["preserve.snapshot", "write-tree"],
      ["preserve.replay"], ["preserve.replay", "HEAD^{tree}"],
      ["preserve.recheck-snapshot"], ["preserve.recheck-binding"],
      ["preserve.commit"], ["preserve.commit", "commit-tree"], ["preserve.commit", "update-ref"]
    ];
    for (const [stage, arg] of stalls) {
      const error = timeoutAt(stage, arg);
      expectTypedTimeout(error, stage, arg && !arg.includes("^") ? arg : undefined);
      // Index bytes, porcelain status and lock files are exactly as before.
      expect(observe()).toEqual(before);
    }
    // Five validation-stage timeouts in a row never consumed the refusal budget.
    withDatabase(f.workspace, db => expect(getPreservationRefusalAttempts(db, binding.reservationId)).toBe(0));

    const receipt = preserve().data.receipt;
    expect(receipt.requestId).toBe(manualPreservationRequestId(binding, receipt.candidateFingerprint));
    expect(observe()).toMatchObject({ status: "", lock: false, ahead: "1" });
  }, 180_000);

  it("never reads an ancestry or merge-tree timeout as a rewritten or conflicting base", () => {
    const { f, observe, preserve, timeoutAt } = setup({ advanceBase: true });
    const before = observe();
    for (const [stage, arg] of [
      ["binding.manual", "--is-ancestor"], ["binding.manual", "merge-tree"],
      ["preserve.preconditions", "--is-ancestor"], ["preserve.preconditions", "merge-tree"]
    ] as const) {
      expectTypedTimeout(timeoutAt(stage, arg), stage, arg === "--is-ancestor" ? "merge-base" : arg);
      expect(observe()).toEqual(before);
    }
    expect(preserve().data.receipt.baseRevision).toBe(f.base);
    expect(observe()).toMatchObject({ status: "", lock: false, ahead: "1" });
  }, 120_000);

  it(`keeps ${MAX_IDENTICAL_PRESERVATION_REFUSALS} consecutive identical timeouts outside the refusal budget`, () => {
    const { f, binding, preserve, timeoutAt } = setup();
    for (let attempt = 0; attempt < MAX_IDENTICAL_PRESERVATION_REFUSALS + 1; attempt += 1) {
      expectTypedTimeout(timeoutAt("validation.snapshot"), "validation.snapshot");
      withDatabase(f.workspace, db => expect(getPreservationRefusalAttempts(db, binding.reservationId)).toBe(0));
    }
    expect(preserve().data.receipt.preservationState).toBe("LOCAL ONLY");
  }, 120_000);

  it("retries a timeout after the commit became durable with the same request id and exactly one commit", () => {
    const { f, binding, observe, preserve, timeoutAt } = setup();
    // update-ref succeeded; only the post-commit index sync stalls.
    expectTypedTimeout(timeoutAt("preserve.commit", "read-tree"), "preserve.commit", "read-tree");
    expect(observe()).toMatchObject({ ahead: "1", lock: false });
    const committed = fixtureGit(f.candidate, ["rev-parse", BRANCH]);
    const receipt = preserve().data.receipt;
    expect(receipt).toMatchObject({ commitSha: committed, replayed: false,
      requestId: manualPreservationRequestId(binding, receipt.candidateFingerprint) });
    expect(fixtureGit(f.candidate, ["log", "-1", "--format=%B"])).toContain(`Arcadia-Preservation-Request: ${receipt.requestId}`);
    expect(observe()).toMatchObject({ status: "", lock: false, ahead: "1" });
    expect(preserve().data.receipt).toMatchObject({ requestId: receipt.requestId, commitSha: committed, replayed: true });
  }, 60_000);
});
