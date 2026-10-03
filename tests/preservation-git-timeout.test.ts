import { existsSync, mkdirSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixtureGit } from "../scripts/preservation-fixture.js";
import { withDatabase } from "../src/db/connection.js";
import { ArcadiaError, preservationGitTimeout, validationError } from "../src/cli/errors.js";
import { runPreserveCommand } from "../src/commands/preserve.js";
import { git, isAncestor, mergesCleanly, tryGit } from "../src/git/worktrees.js";
import { manualPreservationRequestId } from "../src/sessions/manualPreservation.js";
import { commitTreeAt, snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { systemPreservationRemote } from "../src/sessions/candidatePreservation.js";
import { bindCheckDefinitions } from "../src/sessions/preservationCheckBinding.js";
import { goTransportFailure } from "../src/sessions/goRequestExecutor.js";
import { preservationResponseError } from "../src/sessions/preservationTransport.js";
import {
  getPreservationIndexLockAttempts, getPreservationRefusalAttempts, getPreservationTimeoutAttempts, guardPreservationRefusal, guardPreservationTimeouts,
  MAX_IDENTICAL_PRESERVATION_INDEX_LOCKS, MAX_IDENTICAL_PRESERVATION_REFUSALS, MAX_IDENTICAL_PRESERVATION_TIMEOUTS
} from "../src/sessions/preservationRefusalBudget.js";
import {
  PRESERVATION_GIT_TIMEOUT_MAX_MS, PRESERVATION_GIT_TIMEOUT_MS, PRESERVATION_STAGE_TIMEOUT_MS, preservationGitTimeoutMs,
  preservationIndexLocked, preservationIndexLockMalformed, preservationProcessLimits, preservationStage, withPreservationProgress
} from "../src/sessions/preservationStages.js";
import {
  BRANCH, CALL_TIMEOUT_MS, expectTypedTimeout, HUNG_CALL_TIMEOUT_MS, installTimeoutFixtureHooks, mockValidationWithRealGit,
  plainFixture, testCallTimeout, timeoutFixture
} from "./preservationTimeoutFixture.js";

installTimeoutFixtureHooks();

const caught = (run: () => unknown) => {
  try { run(); } catch (error) { return error as ArcadiaError; }
  throw new Error("expected a failure");
};

describe("preservation git timeout bounds", () => {
  it("defaults the per-call bound below the stage idle limit and caps any override with headroom", () => {
    expect(PRESERVATION_GIT_TIMEOUT_MS).toBeLessThanOrEqual(PRESERVATION_GIT_TIMEOUT_MAX_MS);
    // One heartbeat interval (5s) plus one maximal call still fits the watchdog.
    expect(PRESERVATION_GIT_TIMEOUT_MAX_MS + 5_000).toBeLessThan(PRESERVATION_STAGE_TIMEOUT_MS);
    expect(preservationGitTimeoutMs({})).toBe(PRESERVATION_GIT_TIMEOUT_MS);
    expect(preservationGitTimeoutMs({ ARCADIA_PRESERVATION_GIT_TIMEOUT_MS: "45000" })).toBe(45_000);
    for (const capped of ["120001", "149999", "900000"]) {
      expect(preservationGitTimeoutMs({ ARCADIA_PRESERVATION_GIT_TIMEOUT_MS: capped })).toBe(PRESERVATION_GIT_TIMEOUT_MAX_MS);
    }
    for (const ignored of ["0", "-1", "1.5", "slow"]) {
      expect(preservationGitTimeoutMs({ ARCADIA_PRESERVATION_GIT_TIMEOUT_MS: ignored })).toBe(PRESERVATION_GIT_TIMEOUT_MS);
    }
    vi.stubEnv("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS", "45000");
    const limits = () => preservationProcessLimits("git", ["status"]);
    expect(withPreservationProgress(() => undefined, limits)).toEqual({ timeout: 45_000, killSignal: "SIGKILL" });
    expect(withPreservationProgress(() => undefined, limits, { gitTimeoutMs: 999_999 }))
      .toEqual({ timeout: PRESERVATION_GIT_TIMEOUT_MAX_MS, killSignal: "SIGKILL" });
    expect(limits()).toEqual({});
  });

  it("restarts the stage idle clock at the start of every bounded call, so slow successful calls never trip the watchdog", () => {
    const f = plainFixture();
    for (let index = 0; index < 8; index += 1) writeFileSync(path.join(f.candidate, `file-${index}.txt`), `${index}\n`);
    // Each bounded call below is simulated as taking 70s: well inside its own
    // bound, but two of them back to back exceed the 150s stage limit.
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const events: number[] = [];
    const slowCall = <T>(call: () => T): T => { clock += 70_000; return call(); };
    withPreservationProgress(() => events.push(clock), () => {
      preservationStage("preserve.preconditions");
      const head = slowCall(() => git(f.candidate, ["rev-parse", "HEAD"]).trim());
      slowCall(() => tryGit(f.repo, ["rev-parse", "main"]));
      slowCall(() => isAncestor(f.repo, f.base, head));
      const tree = slowCall(() => snapshotCandidate(f.candidate));
      const commit = slowCall(() => commitTreeAt(f.repo, tree, head));
      slowCall(() => mergesCleanly(f.repo, commit, head));
      slowCall(() => bindCheckDefinitions(f.repo, f.base, tree, ["node check.mjs"]));
    });
    const elapsed = clock - events[0];
    const gaps = events.slice(1).map((at, index) => at - events[index]);
    // One stage event, then one heartbeat as each of the seven calls starts.
    expect(events).toHaveLength(8);
    expect(elapsed).toBeGreaterThan(3 * PRESERVATION_STAGE_TIMEOUT_MS);
    expect(Math.max(...gaps)).toBeLessThan(PRESERVATION_STAGE_TIMEOUT_MS);
    expect(gaps.every(gap => gap <= 70_000)).toBe(true);
  });
});

describe("preservation git timeouts end to end", () => {
  it("survives three identical timeouts, a killed post-commit index sync and its lock, then recovers the same commit", () => {
    mockValidationWithRealGit();
    const { f, binding, lockPath, observe, preserve, failure, timeoutAt } = timeoutFixture();
    const before = observe();
    for (let attempt = 0; attempt < MAX_IDENTICAL_PRESERVATION_REFUSALS; attempt += 1) {
      expectTypedTimeout(timeoutAt("validation.snapshot"), "validation.snapshot", { subcommand: "rev-parse", cwds: [f.candidate] });
      expect(observe()).toEqual(before);
    }
    withDatabase(f.workspace, db => {
      expect(getPreservationRefusalAttempts(db, binding.reservationId)).toBe(0);
      expect(getPreservationTimeoutAttempts(db, binding.reservationId)).toBe(MAX_IDENTICAL_PRESERVATION_REFUSALS);
    });

    // The commit becomes durable, then the post-commit index sync is killed
    // while holding the real index lock.
    const synced = timeoutAt("preserve.index-sync", "read-tree", true);
    expectTypedTimeout(synced, "preserve.index-sync", { subcommand: "read-tree", cwds: [f.candidate] });
    expect(synced.details.remedy).toContain("already durable");
    expect(observe()).toMatchObject({ ahead: "1", lock: true });
    const committed = fixtureGit(f.candidate, ["rev-parse", BRANCH]);
    const timeoutsBeforeLock = withDatabase(f.workspace, db => getPreservationTimeoutAttempts(db, binding.reservationId));

    // A fresh lock may belong to a live Git process: refused as retryable, kept.
    const locked = failure();
    expect(locked.code).toBe("PRESERVATION_INDEX_LOCKED");
    expect(locked.exitCode).toBe(1);
    expect(locked.details).toMatchObject({ retryable: true, reason: "index_locked", liveness: "fresh", stage: "preserve.index-sync" });
    expect(realpathSync(String(locked.details.lockPath))).toBe(realpathSync(lockPath));
    expect(locked.message).toContain("may still be running");
    expect(existsSync(lockPath)).toBe(true);
    // The lock refusal is not a timeout: the timeout streak is untouched.
    withDatabase(f.workspace, db => {
      expect(getPreservationTimeoutAttempts(db, binding.reservationId)).toBe(timeoutsBeforeLock);
      expect(getPreservationIndexLockAttempts(db, binding.reservationId)).toBe(1);
    });

    // A stale lock is removed; the retry recovers the same commit and ends clean.
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lockPath, old, old);
    const receipt = preserve().data.receipt;
    expect(receipt).toMatchObject({ commitSha: committed, replayed: false,
      requestId: manualPreservationRequestId(binding, receipt.candidateFingerprint) });
    expect(fixtureGit(f.candidate, ["log", "-1", "--format=%B"])).toContain(`Arcadia-Preservation-Request: ${receipt.requestId}`);
    expect(observe()).toMatchObject({ status: "", lock: false, ahead: "1" });
    expect(preserve().data.receipt).toMatchObject({ requestId: receipt.requestId, commitSha: committed, replayed: true });
    withDatabase(f.workspace, db => expect(getPreservationTimeoutAttempts(db, binding.reservationId)).toBe(0));
  }, 120_000);

  it("types a Python capture timeout instead of reporting a refused capture, outside the refusal budget", () => {
    mockValidationWithRealGit();
    const { f, binding } = timeoutFixture();
    const error = caught(() => withPreservationProgress(() => undefined,
      () => runPreserveCommand({ source: f.candidate, workspace: f.workspace }), { gitTimeoutMs: ({ command }) => command === "/usr/bin/python3" ? 1 : CALL_TIMEOUT_MS }));
    expect(error.code).toBe("PRESERVATION_GIT_TIMEOUT");
    expect(error.details).toMatchObject({ retryable: true, command: "/usr/bin/python3", gitSubcommand: null, stage: "validation.snapshot",
      args: ["-I", "-c", "<candidate capture>", f.candidate], timeoutMs: 1 });
    expect(error.message).not.toMatch(/capture refused/i);
    withDatabase(f.workspace, db => expect(getPreservationRefusalAttempts(db, binding.reservationId)).toBe(0));
  });

  it("keeps the typed timeout through the real validation entry and the host transport", () => {
    // No validation mock: the real validateBoundCandidate runs up to its first
    // stalled Git call, which happens before its macOS-only Seatbelt check.
    const { f, binding, stages, observe, timeoutAt } = timeoutFixture();
    const before = observe();
    const error = timeoutAt("validation.check-definitions", "ls-tree");
    expect(stages.at(-1)).toBe("validation.check-definitions");
    expectTypedTimeout(error, "validation.check-definitions", { subcommand: "ls-tree", cwds: [f.repo] });
    const transported = goTransportFailure(error);
    if (transported.ok) throw new Error("transport reported success");
    const received = preservationResponseError(transported.error);
    expect(received.code).toBe("PRESERVATION_GIT_TIMEOUT");
    expect(received.exitCode).toBe(1);
    expect(received.message).toBe(error.message);
    expect(received.details).toEqual(error.details);
    expect(observe()).toEqual(before);
    withDatabase(f.workspace, db => expect(getPreservationRefusalAttempts(db, binding.reservationId)).toBe(0));
  });

  // validateBoundCandidate refuses any non-macOS host before materializing the
  // snapshot (Seatbelt is the only supported validation sandbox), so its
  // try/catch/finally around materialization only runs on macOS.
  it.skipIf(process.platform !== "darwin")("keeps the failing stage through preservationStageFailure after cleanup reports", () => {
    const { stages, observe, timeoutAt } = timeoutFixture();
    const before = observe();
    const error = timeoutAt("validation.materialize", "cat-file");
    // The finally block reported validation.cleanup after the failure, yet the
    // typed error still names the stage that actually stalled.
    expect(stages.slice(-2)).toEqual(["validation.materialize", "validation.cleanup"]);
    expectTypedTimeout(error, "validation.materialize", { subcommand: "cat-file" });
    expect(observe()).toEqual(before);
  });

  it("types push and every gh call, warning that a pull-request write may already have happened", () => {
    const { f, stageFile } = timeoutFixture();
    vi.stubEnv("ARCADIA_TEST_HANG_GH", "1");
    vi.stubEnv("ARCADIA_TEST_HANG_STAGE", "preserve.push");
    vi.stubEnv("ARCADIA_TEST_HANG_ARG", "push");
    const remote = systemPreservationRemote;
    // Report stages to the shim, so only the deliberately stalled call hangs.
    const run = (stage: string, call: () => unknown) => caught(() => withPreservationProgress(reported => writeFileSync(stageFile, reported), () => {
      preservationStage(stage);
      call();
    }, { gitTimeoutMs: testCallTimeout }));

    const pushed = run("preserve.push", () => remote.push({ repositoryPath: f.repo, branch: BRANCH }));
    expect(pushed.code, pushed.message).toBe("PRESERVATION_GIT_TIMEOUT");
    expect(pushed.details).toMatchObject({ retryable: true, command: "git", gitSubcommand: "push", stage: "preserve.push",
      args: ["push", "--set-upstream", "origin", BRANCH], cwd: f.repo, timeoutMs: HUNG_CALL_TIMEOUT_MS });
    expect(pushed.details.remedy).toContain("already durable");

    const viewed = run("preserve.pull-request", () => remote.findPullRequest({ repositoryPath: f.repo, branch: BRANCH }));
    expect(viewed.code).toBe("PRESERVATION_GIT_TIMEOUT");
    expect(viewed.details).toMatchObject({ command: "gh", args: ["pr", "view", BRANCH, "--json", "number,url"], cwd: f.repo });
    expect(viewed.details.remedy).toContain("already durable");

    const upsert = { repositoryPath: f.repo, branch: BRANCH, baseBranch: "main", title: "Candidate", body: "QA" };
    const edited = run("preserve.pull-request", () => remote.upsertDraftPullRequest({ ...upsert, existing: { number: 7, url: "https://example.test/pull/7" } }));
    expect(edited.details).toMatchObject({ retryable: true, command: "gh", args: ["pr", "edit", "7", "--body", "QA"] });
    const created = run("preserve.pull-request", () => remote.upsertDraftPullRequest({ ...upsert, existing: null }));
    expect(created.details).toMatchObject({ retryable: true, command: "gh",
      args: ["pr", "create", "--draft", "--base", "main", "--head", BRANCH, "--title", "Candidate", "--body", "QA"] });
    for (const write of [edited, created]) {
      expect(write.code).toBe("PRESERVATION_GIT_TIMEOUT");
      expect(write.details.remedy).toContain("Check for an existing pull request first");
      expect(write.details.remedy).toContain(`gh pr view ${BRANCH}`);
    }
  });
});

describe("check-definition binding timeouts", () => {
  it("surfaces a package manifest read timeout instead of treating the manifest as unparsable", () => {
    const { f, stageFile } = timeoutFixture();
    mkdirSync(path.join(f.repo, "rules"));
    writeFileSync(path.join(f.repo, "rules", "package.json"), JSON.stringify({ main: "judge.js" }));
    writeFileSync(path.join(f.repo, "rules", "judge.js"), "export default true;\n");
    writeFileSync(path.join(f.repo, "check.mjs"), "import judge from \"./rules\";\nif (!judge) process.exit(1);\n");
    fixtureGit(f.repo, ["add", "-A"]);
    fixtureGit(f.repo, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "directory-import check"]);
    const head = fixtureGit(f.repo, ["rev-parse", "HEAD"]);
    const tree = fixtureGit(f.repo, ["rev-parse", "HEAD^{tree}"]);
    const manifest = fixtureGit(f.repo, ["rev-parse", "HEAD:rules/package.json"]);
    const bind = () => withPreservationProgress(stage => writeFileSync(stageFile, stage), () => {
      preservationStage("validation.check-definitions");
      return bindCheckDefinitions(f.repo, head, tree, ["node check.mjs"]);
    }, { gitTimeoutMs: testCallTimeout });
    // Unhung, the manifest's "main" is followed and bound.
    expect(bind().files.map(file => file.path)).toContain("rules/judge.js");
    // Then only the manifest read hangs, in the shim.
    vi.stubEnv("ARCADIA_TEST_HANG_STAGE", "validation.check-definitions");
    vi.stubEnv("ARCADIA_TEST_HANG_ARG", manifest);
    const error = caught(bind);
    expect(error.code).toBe("PRESERVATION_GIT_TIMEOUT");
    expect(error.details).toMatchObject({ retryable: true, stage: "validation.check-definitions", gitSubcommand: "cat-file",
      args: ["cat-file", "blob", manifest], cwd: f.repo, timeoutMs: HUNG_CALL_TIMEOUT_MS });
  });
});

describe("identical-timeout budget", () => {
  const NOW = new Date("2026-10-02T00:00:00.000Z");
  const timeout = (stage = "preserve.snapshot") => preservationGitTimeout("git hash-object exceeded its budget", {
    reason: "timeout", command: "git", gitSubcommand: "hash-object", args: ["hash-object"], cwd: "/x", timeoutMs: 1, stage, remedy: "retry"
  });
  const refusal = () => validationError("Declared preservation validation failed or was skipped.", { checks: ["node check.mjs"] });

  it("counts real refusals exactly as before, unreset by an intervening timeout, and caps identical timeouts separately", () => {
    const f = plainFixture();
    withDatabase(f.workspace, db => {
      const attempt = (error: Error) => caught(() => guardPreservationRefusal(db, "subject", NOW, () => { throw error; }));
      const step = (error: Error) => caught(() => guardPreservationTimeouts(db, "subject", NOW, () => { throw error; }));
      expect(attempt(refusal()).details.identicalRefusalLimitReached).toBeUndefined();
      expect(attempt(timeout()).code).toBe("PRESERVATION_GIT_TIMEOUT");
      expect(getPreservationRefusalAttempts(db, "subject")).toBe(1);
      expect(attempt(refusal()).details.identicalRefusalLimitReached).toBeUndefined();
      expect(getPreservationRefusalAttempts(db, "subject")).toBe(2);
      expect(attempt(refusal()).details).toMatchObject({ identicalRefusalLimitReached: true, attempts: MAX_IDENTICAL_PRESERVATION_REFUSALS });

      // Timeouts accumulate on their own count: the validation guard and the
      // preservation-step guard share it, and a different timeout resets it.
      expect(step(refusal()).code).toBe("VALIDATION_ERROR");
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(1);
      expect(step(timeout("preserve.commit")).code).toBe("PRESERVATION_GIT_TIMEOUT");
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(1);
      for (let count = 2; count < MAX_IDENTICAL_PRESERVATION_TIMEOUTS; count += 1) {
        const error = count % 2 ? attempt(timeout("preserve.commit")) : step(timeout("preserve.commit"));
        expect(error.code).toBe("PRESERVATION_GIT_TIMEOUT");
        expect(getPreservationTimeoutAttempts(db, "subject")).toBe(count);
      }
      const capped = step(timeout("preserve.commit"));
      expect(capped.code).toBe("VALIDATION_ERROR");
      expect(capped.message).toMatch(new RegExp(`timed out the same way ${MAX_IDENTICAL_PRESERVATION_TIMEOUTS} times.*will not be retried automatically`));
      expect(capped.details).toMatchObject({ retryable: false, identicalTimeoutLimitReached: true, identicalRefusalLimitReached: true,
        attempts: MAX_IDENTICAL_PRESERVATION_TIMEOUTS, stage: "preserve.commit", remedy: expect.stringContaining("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS") });

      expect(guardPreservationTimeouts(db, "subject", NOW, () => "preserved")).toBe("preserved");
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(0);
    });
  });

  it("counts index_locked on its own budget: it neither consumes nor resets the timeout streak, and caps with a lock remedy", () => {
    const f = plainFixture();
    const locked = () => preservationIndexLocked("/x/.git/index.lock", 10);
    withDatabase(f.workspace, db => {
      const step = (error: Error) => caught(() => guardPreservationTimeouts(db, "subject", NOW, () => { throw error; }));
      step(timeout("preserve.commit"));
      step(timeout("preserve.commit"));
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(2);

      // An interleaved lock refusal is not a timeout: the streak survives it.
      const first = step(locked());
      expect(first.code).toBe("PRESERVATION_INDEX_LOCKED");
      expect(first.details).toMatchObject({ retryable: true, reason: "index_locked" });
      expect(first.details.remedy).not.toContain("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS");
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(2);
      expect(getPreservationIndexLockAttempts(db, "subject")).toBe(1);
      step(timeout("preserve.commit"));
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(3);
      expect(getPreservationIndexLockAttempts(db, "subject")).toBe(1);

      for (let count = 2; count < MAX_IDENTICAL_PRESERVATION_INDEX_LOCKS; count += 1) {
        expect(step(locked()).code).toBe("PRESERVATION_INDEX_LOCKED");
        expect(getPreservationIndexLockAttempts(db, "subject")).toBe(count);
        expect(getPreservationTimeoutAttempts(db, "subject")).toBe(3);
      }
      const capped = step(locked());
      expect(capped.code).toBe("VALIDATION_ERROR");
      expect(capped.message).toMatch(new RegExp(`index lock blocked preservation the same way ${MAX_IDENTICAL_PRESERVATION_INDEX_LOCKS} times.*will not be retried automatically`));
      expect(capped.message).not.toMatch(/timed out|ARCADIA_PRESERVATION_GIT_TIMEOUT_MS/);
      expect(capped.details).toMatchObject({ retryable: false, identicalIndexLockLimitReached: true, identicalRefusalLimitReached: true,
        attempts: MAX_IDENTICAL_PRESERVATION_INDEX_LOCKS, reason: "index_locked" });
      expect(capped.details.identicalTimeoutLimitReached).toBeUndefined();
      expect(String(capped.details.remedy)).not.toContain("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS");
      // The capped lock refusal never touched the timeout count either.
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(3);

      expect(guardPreservationTimeouts(db, "subject", NOW, () => "preserved")).toBe("preserved");
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(0);
      expect(getPreservationIndexLockAttempts(db, "subject")).toBe(0);
    });
  });

  it("never trips the timeout cap on index_locked alone, outside the refusal budget, and transports its own code and retryable flag", () => {
    const f = plainFixture();
    const lockPath = "/x/.git/index.lock";
    withDatabase(f.workspace, db => {
      const viaValidation = (error: Error) => caught(() => guardPreservationRefusal(db, "subject", NOW, () => { throw error; }));
      const viaStep = (error: Error) => caught(() => guardPreservationTimeouts(db, "subject", NOW, () => { throw error; }));
      // Distinct lock ages and liveness never change the fingerprint: these are
      // identical lock refusals, alternating between both guards.
      for (let count = 1; count < MAX_IDENTICAL_PRESERVATION_INDEX_LOCKS; count += 1) {
        const error = (count % 2 ? viaValidation : viaStep)(preservationIndexLocked(lockPath, count, { liveness: "held", holderPids: [count] }));
        expect(error.code).toBe("PRESERVATION_INDEX_LOCKED");
        expect(error.details.identicalTimeoutLimitReached).toBeUndefined();
      }
      expect(getPreservationTimeoutAttempts(db, "subject")).toBe(0);
      expect(getPreservationRefusalAttempts(db, "subject")).toBe(0);
      expect(getPreservationIndexLockAttempts(db, "subject")).toBe(MAX_IDENTICAL_PRESERVATION_INDEX_LOCKS - 1);
    });

    const error = preservationIndexLocked(lockPath, 10, { liveness: "unknown", livenessError: "file-holder probe: lsof could not run" });
    expect(error.code).toBe("PRESERVATION_INDEX_LOCKED");
    expect(error.exitCode).toBe(1);
    expect(String(error.details.remedy)).not.toContain("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS");
    for (const sent of [error, preservationIndexLockMalformed(lockPath, "directory")]) {
      const transported = goTransportFailure(sent);
      if (transported.ok) throw new Error("transport reported success");
      const received = preservationResponseError(transported.error);
      expect(received.code).toBe("PRESERVATION_INDEX_LOCKED");
      expect(received.exitCode).toBe(1);
      expect(received.details).toEqual(sent.details);
    }
    expect(preservationIndexLockMalformed(lockPath, "directory").details.retryable).toBe(false);
  });
});
