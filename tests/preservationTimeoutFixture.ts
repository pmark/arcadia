import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureGit, manualPreservationFixture } from "../scripts/preservation-fixture.js";
import { withDatabase } from "../src/db/connection.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { runPreserveCommand } from "../src/commands/preserve.js";
import { bindManualPreservation, manualPreservationRequestId } from "../src/sessions/manualPreservation.js";
import { getPreservationRefusalAttempts } from "../src/sessions/preservationRefusalBudget.js";
import { materializeCandidateTree, snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { bindCheckDefinitions } from "../src/sessions/preservationCheckBinding.js";
import { preservationStage, withPreservationProgress, type PreservationCallTimeout } from "../src/sessions/preservationStages.js";
import * as validation from "../src/sessions/preservationValidation.js";

/** Shared by the preservation timeout suites: a disposable manual fixture, a
 * hung `git`/`gh` PATH shim and a per-call bound that is short only for the
 * one call the shim stalls, so no unhung call can time out under load. */
export const HUNG_CALL_TIMEOUT_MS = 300;
export const CALL_TIMEOUT_MS = 15_000;
export const BRANCH = "codex/preservation-fixture";

/** Stage-matched bound mirroring the shim's own hang condition. */
export const testCallTimeout: PreservationCallTimeout = ({ command, args, stage }) => {
  const hangStage = process.env.ARCADIA_TEST_HANG_STAGE;
  const hangArg = process.env.ARCADIA_TEST_HANG_ARG;
  if (command === "gh" && process.env.ARCADIA_TEST_HANG_GH) return HUNG_CALL_TIMEOUT_MS;
  return command === "git" && hangStage && stage === hangStage && (!hangArg || args.includes(hangArg))
    ? HUNG_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS;
};

const fixtures: ReturnType<typeof manualPreservationFixture>[] = [];

/** A PATH `git` that hangs only while the reported stage (and optional argument)
 * matches; with ARCADIA_TEST_HANG_LOCK it first takes the real index lock, as a
 * `read-tree` killed mid-write would leave it. A PATH `gh` always hangs. */
function hungShims(root: string) {
  const realGit = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = path.join(root, "hung-bin");
  mkdirSync(bin);
  const stageFile = path.join(root, "current-stage");
  writeFileSync(path.join(bin, "git"), `#!/bin/sh
hang() {
  if [ -n "$ARCADIA_TEST_HANG_LOCK" ]; then : > "$('${realGit}' rev-parse --path-format=absolute --git-path index.lock)"; fi
  exec sleep 30
}
current=; [ -n "$ARCADIA_TEST_HANG_STAGE" ] && read -r current < '${stageFile}' 2>/dev/null
if [ -n "$ARCADIA_TEST_HANG_STAGE" ] && [ "$current" = "$ARCADIA_TEST_HANG_STAGE" ]; then
  if [ -z "$ARCADIA_TEST_HANG_ARG" ]; then hang; fi
  for arg in "$@"; do [ "$arg" = "$ARCADIA_TEST_HANG_ARG" ] && hang; done
fi
exec '${realGit}' "$@"
`);
  writeFileSync(path.join(bin, "gh"), "#!/bin/sh\nexec sleep 30\n");
  chmodSync(path.join(bin, "git"), 0o755);
  chmodSync(path.join(bin, "gh"), 0o755);
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  return stageFile;
}

/** Read-only observation: never refreshes the index stat cache it compares. */
export function observeCandidate(candidate: string) {
  const gitDir = fixtureGit(candidate, ["rev-parse", "--absolute-git-dir"]);
  const index = path.join(gitDir, "index");
  return {
    index: readFileSync(index).toString("base64"),
    indexMtimeMs: statSync(index).mtimeMs,
    // Untrimmed: the leading column distinguishes ` M` (unstaged) from `M ` (staged).
    status: execFileSync("git", ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"], { cwd: candidate, encoding: "utf8" }),
    lock: existsSync(path.join(gitDir, "index.lock"))
  };
}

export function timeoutFixture(options: { advanceBase?: boolean } = {}) {
  const f = manualPreservationFixture(); fixtures.push(f);
  // A tracked modification (` M`) and an untracked file (`??`): the shapes the
  // old real-index `read-tree` silently turned into staged changes.
  appendFileSync(path.join(f.candidate, "PROJECT.md"), "candidate edit\n");
  const binding = withDatabase(f.workspace, db => bindManualPreservation(db, {
    repository: f.repo, worktree: f.candidate, baseBranch: "main", projectSlug: "preservation-fixture"
  }));
  if (options.advanceBase) {
    writeFileSync(path.join(f.repo, "unrelated.txt"), "advanced base\n");
    fixtureGit(f.repo, ["add", "unrelated.txt"]);
    fixtureGit(f.repo, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "advance base cleanly"]);
  }
  const lockPath = path.join(fixtureGit(f.candidate, ["rev-parse", "--absolute-git-dir"]), "index.lock");
  const stageFile = hungShims(f.root);
  const stages: string[] = [];
  const observe = () => ({ ...observeCandidate(f.candidate), ahead: fixtureGit(f.candidate, ["rev-list", "--count", `${f.base}..${BRANCH}`]) });
  const preserve = () => withPreservationProgress(stage => { stages.push(stage); writeFileSync(stageFile, stage); },
    () => runPreserveCommand({ source: f.candidate, workspace: f.workspace }), { gitTimeoutMs: testCallTimeout });
  const failure = () => {
    try { preserve(); } catch (error) { return error as ArcadiaError; }
    throw new Error("Preservation unexpectedly succeeded");
  };
  const timeoutAt = (stage: string, arg?: string, lock = false) => {
    vi.stubEnv("ARCADIA_TEST_HANG_STAGE", stage);
    vi.stubEnv("ARCADIA_TEST_HANG_ARG", arg ?? "");
    vi.stubEnv("ARCADIA_TEST_HANG_LOCK", lock ? "1" : "");
    try { return failure(); } finally { vi.stubEnv("ARCADIA_TEST_HANG_STAGE", ""); }
  };
  return { f, binding, lockPath, stageFile, stages, observe, preserve, failure, timeoutAt };
}

export function expectTypedTimeout(error: ArcadiaError, stage: string, options: { subcommand?: string; arg?: string; cwds?: string[] } = {}) {
  expect(error, `${error?.message} ${JSON.stringify(error?.details)}`.slice(0, 600)).toBeInstanceOf(ArcadiaError);
  expect(error.code, `${error.message} ${JSON.stringify(error.details)}`.slice(0, 600)).toBe("PRESERVATION_GIT_TIMEOUT");
  expect(error.message).not.toMatch(/could not be resolved|not a forward advance|Unexpected error|ETIMEDOUT|capture refused/i);
  expect(error.details).toMatchObject({
    retryable: true, reason: "timeout", command: "git", stage, timeoutMs: HUNG_CALL_TIMEOUT_MS,
    remedy: expect.stringContaining("Retry the same fixed protected launcher")
  });
  const { gitSubcommand, args, cwd } = error.details as { gitSubcommand: string; args: string[]; cwd: string };
  if (options.subcommand) expect(gitSubcommand).toBe(options.subcommand);
  expect(args).toContain(gitSubcommand);
  if (options.arg) expect(args).toContain(options.arg);
  if (options.cwds) expect(options.cwds).toContain(cwd);
  expect(error.message).toContain(`git ${gitSubcommand} exceeded its ${HUNG_CALL_TIMEOUT_MS} ms preservation budget at stage ${stage}`);
  expect(error.details.identicalRefusalLimitReached).toBeUndefined();
}

/** Seatbelt validation is proven by the gated host suite; this mirrors its
 * stage sequence and real Git calls so each validation stage can be stalled. */
export function mockValidationWithRealGit() {
  vi.spyOn(validation, "validateBoundCandidate").mockImplementation((_workspace, candidate, binding, assertBinding) => {
    preservationStage("validation.binding");
    assertBinding();
    preservationStage("validation.snapshot");
    const tree = snapshotCandidate(candidate.worktree);
    preservationStage("validation.check-definitions");
    bindCheckDefinitions(candidate.repository, candidate.base, tree, candidate.commands);
    preservationStage("validation.materialize");
    const scratch = mkdtempSync(path.join(path.dirname(candidate.worktree), "arcadia-materialize-"));
    try { materializeCandidateTree(candidate.worktree, tree, scratch); } finally { rmSync(scratch, { recursive: true, force: true }); }
    preservationStage("validation.recheck-binding");
    assertBinding();
    preservationStage("validation.recheck-snapshot");
    if (snapshotCandidate(candidate.worktree) !== tree) throw new Error("candidate changed");
    return { passed: true, evidenceRef: "fixture-validation-only", candidateFingerprint: tree, binding };
  });
}

export function installTimeoutFixtureHooks() {
  beforeEach(() => { vi.stubEnv("CODEX_SANDBOX", ""); });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const f of fixtures.splice(0)) {
      rmSync(f.candidate, { recursive: true, force: true }); rmSync(f.root, { recursive: true, force: true });
    }
  });
}

export function plainFixture() {
  const f = manualPreservationFixture(); fixtures.push(f);
  return f;
}

/** Stall one call at each listed stage before the commit, then preserve once.
 * The stage list is split across suite files so they run in parallel. */
export function describeStageStalls(title: string, stalls: Array<[stage: string, arg?: string]>) {
  installTimeoutFixtureHooks();
  beforeEach(mockValidationWithRealGit);
  describe(title, () => {
    it("raises the typed retryable timeout, leaves the candidate untouched, and a clean retry preserves once", () => {
      const { f, binding, observe, preserve, timeoutAt } = timeoutFixture();
      const before = observe();
      expect(before.status).toContain(" M PROJECT.md");
      expect(before.status).toContain("?? marker.txt");
      for (const [stage, arg] of stalls) {
        const error = timeoutAt(stage, arg);
        expectTypedTimeout(error, stage, { subcommand: arg && !arg.includes("^") ? arg : undefined, arg, cwds: [f.candidate, f.repo] });
        expect(error.details.remedy).toContain(stage === "preserve.commit" ? "may or may not have advanced" : "Nothing was committed");
        if (arg === "update-ref") {
          expect((error.details.args as string[]).slice(0, 4)).toEqual(["-c", "core.hooksPath=/dev/null", "update-ref", `refs/heads/${BRANCH}`]);
          expect(error.details.cwd).toBe(f.candidate);
        }
        // Index bytes and mtime, porcelain status and lock files are exactly as before.
        expect(observe(), `${stage} ${arg ?? ""}`).toEqual(before);
      }
      // Validation-stage timeouts never touch the ordinary refusal budget.
      withDatabase(f.workspace, db => expect(getPreservationRefusalAttempts(db, binding.reservationId)).toBe(0));

      const receipt = preserve().data.receipt;
      expect(receipt.requestId).toBe(manualPreservationRequestId(binding, receipt.candidateFingerprint));
      expect(observe()).toMatchObject({ status: "", lock: false, ahead: "1" });
    }, 120_000);
  });
}
