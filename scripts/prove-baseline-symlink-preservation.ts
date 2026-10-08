import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fixtureGit, manualPreservationFixture } from "./preservation-fixture.js";
import { openDatabase } from "../src/db/connection.js";
import { processPreservationRequests } from "../src/sessions/preservationTransport.js";
import { resolveWorkspace } from "../src/workspace/resolve.js";
import type { CommandSuccess } from "../src/cli/response.js";
import type { PreserveCommandData } from "../src/commands/preserve.js";
import type { CandidatePreservationReceipt } from "../src/sessions/candidatePreservation.js";

/**
 * Disposable, hermetic OS-boundary proof for the unchanged-baseline-symlink
 * trust path (Action: preserve-unchanged-baseline-skill-symlinks), run from
 * an authorized host, never nested inside an agent sandbox:
 *
 *   npx tsx scripts/prove-baseline-symlink-preservation.ts
 *
 * The real installed Claude preserve launcher only submits a one-shot
 * transport request and polls its response file (`requestCandidatePreservation`
 * in preservationTransport.ts) -- that half may legitimately run whatever
 * broker revision happens to be installed. The actual preservation work
 * (`snapshotCandidate`, `preserveCandidate`, Seatbelt validation) runs through
 * `processPreservationRequests`, imported here directly from this checkout's
 * current source, which spawns its own worker child resolved relative to its
 * own module location (`preservationRequestExecutor.ts`) -- never the
 * installed broker's dist. If the installed launcher predates the current
 * `PRESERVATION_REQUEST_FILE` name or request shape, the request below will
 * simply never be seen; that is reported as an explicit gap, not papered over.
 */
const LAUNCHER = "/Users/pmark/.local/bin/arcadia-preserve-broker-claude";

function realIfExists(candidate: string | null): string | null {
  if (!candidate) return null;
  try { return realpathSync(candidate); } catch { return candidate; }
}

function assertDisjoint(label: string, subject: string, forbidden: ReadonlyArray<[string, string | null]>): void {
  const real = realpathSync(subject);
  for (const [forbiddenLabel, forbiddenPath] of forbidden) {
    const realForbidden = realIfExists(forbiddenPath);
    if (!realForbidden) continue;
    assert.notEqual(real, realForbidden, `${label} (${real}) must not be ${forbiddenLabel} (${realForbidden})`);
    assert.ok(!real.startsWith(`${realForbidden}${path.sep}`), `${label} (${real}) must not be nested inside ${forbiddenLabel} (${realForbidden})`);
    assert.ok(!realForbidden.startsWith(`${real}${path.sep}`), `${forbiddenLabel} (${realForbidden}) must not be nested inside ${label} (${real})`);
  }
}

function addBaselineSkillSymlinks(repo: string): void {
  mkdirSync(path.join(repo, "shared-skill"), { recursive: true });
  writeFileSync(path.join(repo, "shared-skill", "README.md"), "shared skill\n");
  symlinkSync("shared-skill", path.join(repo, "skill-link"));
  mkdirSync(path.join(repo, "nested"), { recursive: true });
  symlinkSync("../shared-skill", path.join(repo, "nested", "skill-link"));
}

/** The real index file's exact bytes (never a derived/re-parsed view of it),
 * resolved through `git rev-parse --git-path index` so a worktree's private
 * index (never the shared common-dir one) is read, hex-encoded for a plain
 * equality assertion. */
function readIndexBytes(candidate: string): string {
  const indexPath = path.resolve(candidate, fixtureGit(candidate, ["rev-parse", "--git-path", "index"]));
  return readFileSync(indexPath).toString("hex");
}

interface GitSnapshot { head: string; tree: string; indexBytes: string; status: string; entries: string }
/** `indexBytes` is read first, and `status` always runs with
 * `--no-optional-locks` so a status probe can never refresh-and-rewrite the
 * real index out from under either this snapshot or a later one taken for
 * comparison. `entries` (`ls-files --stage`) is kept only as optional
 * supplementary diagnostic information; the refusal assertions below trust
 * only `indexBytes`, `head`, `tree` and `status`. */
function indexSnapshot(candidate: string): GitSnapshot {
  return {
    indexBytes: readIndexBytes(candidate),
    head: fixtureGit(candidate, ["rev-parse", "HEAD"]),
    tree: fixtureGit(candidate, ["rev-parse", "HEAD^{tree}"]),
    status: fixtureGit(candidate, ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"]),
    entries: fixtureGit(candidate, ["ls-files", "--stage"])
  };
}

/** Asserts the real index bytes, HEAD, tree and status are identical to a
 * snapshot taken immediately before a refused attempt; `entries` is
 * deliberately excluded, since it is only optional supplementary evidence. */
function assertUntouched(before: GitSnapshot, after: GitSnapshot, label: string): void {
  assert.equal(after.indexBytes, before.indexBytes, `${label}: real index bytes changed`);
  assert.equal(after.head, before.head, `${label}: HEAD changed`);
  assert.equal(after.tree, before.tree, `${label}: tree changed`);
  assert.equal(after.status, before.status, `${label}: status changed`);
}

function parseFailureMessage(stderrOrStdout: string): string {
  try {
    const parsed = JSON.parse(stderrOrStdout) as { error?: { message?: string } };
    return parsed.error?.message ?? stderrOrStdout;
  } catch {
    return stderrOrStdout;
  }
}

type PreserveLauncherSuccess = CommandSuccess<PreserveCommandData>;

/** Spawns the REAL installed launcher with NO arguments. Only its per-spawn
 * env points at the disposable fixture workspace; process.env is never mutated. */
function capture(fixture: { candidate: string; workspace: string }): Promise<PreserveLauncherSuccess> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const child = spawn(LAUNCHER, [], {
      cwd: fixture.candidate,
      env: { ...process.env, ARCADIA_WORKSPACE: fixture.workspace },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const limit = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Fixture launcher exceeded 120 seconds"));
    }, 120_000);
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(limit); reject(error); });
    child.on("close", (code) => {
      clearTimeout(limit);
      if (code !== 0) { reject(new Error(parseFailureMessage(err || out))); return; }
      try { resolve(JSON.parse(out) as PreserveLauncherSuccess); }
      catch (error) { reject(new Error(`Launcher produced non-JSON stdout: ${String(error)}: ${out.slice(0, 2000)}`)); }
    });
  });
}

/** Returns the real refusal message so callers record actual evidence instead
 * of a fabricated placeholder string. */
async function expectRefusal(fixture: { candidate: string; workspace: string }, pattern: RegExp, label: string): Promise<string> {
  try {
    await capture(fixture);
    throw new Error(`Expected ${label} to refuse, but it succeeded.`);
  } catch (error) {
    const message = String((error as Error).message);
    assert.match(message, pattern, `${label}: unexpected refusal message: ${message}`);
    return message;
  }
}

function latestValidationEvidence(workspace: string, reservationId: string): { complete: boolean; results: Array<{ command: string; exitStatus: number | null }> } {
  const evidenceRoot = path.join(workspace, "artifacts", "preservation", reservationId);
  const checkDirectories = readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("check-"))
    .map((entry) => entry.name)
    .sort();
  const latest = checkDirectories.at(-1);
  if (!latest) throw new Error(`No preservation validation evidence found under ${evidenceRoot}`);
  return JSON.parse(readFileSync(path.join(evidenceRoot, latest, "validation.json"), "utf8")) as {
    complete: boolean; results: Array<{ command: string; exitStatus: number | null }>;
  };
}

async function main() {
  // --- Before ANY Git preservation request: prove the fixture cannot touch
  // this candidate, the main checkout or the live martianrover workspace. ---
  const thisCandidateRoot = realpathSync(process.cwd());
  const gitCommonDir = realpathSync(path.resolve(thisCandidateRoot, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: thisCandidateRoot, encoding: "utf8" }).trim()));
  const mainCheckoutRoot = path.dirname(gitCommonDir);
  // Read-only resolution, never an assignment: only used to prove the fixture
  // is disjoint from whatever workspace is live for this host.
  const liveWorkspacePath = resolveWorkspace({ cwd: mainCheckoutRoot }).workspacePath;

  const fixture = manualPreservationFixture(undefined, "node check.mjs", addBaselineSkillSymlinks);
  const forbidden: Array<[string, string | null]> = [
    ["this candidate worktree", thisCandidateRoot],
    ["the main checkout", mainCheckoutRoot],
    ["the live martianrover workspace", liveWorkspacePath]
  ];
  assertDisjoint("fixture root", fixture.root, forbidden);
  assertDisjoint("fixture repository", fixture.repo, forbidden);
  assertDisjoint("fixture candidate worktree", fixture.candidate, forbidden);
  assertDisjoint("fixture workspace", fixture.workspace, forbidden);

  // Explicit Git-common-dir proof: the fixture's own repository and the
  // candidate worktree cut from it must share exactly one Git common
  // directory, and that shared directory must be disjoint from the Git
  // common directory this real candidate shares with the main checkout
  // (`gitCommonDir` above, since a linked worktree's `--git-common-dir`
  // always resolves to the main checkout's own `.git`) and from the live
  // workspace -- never merely their root paths.
  const fixtureRepoCommonDir = realpathSync(path.resolve(fixture.repo, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: fixture.repo, encoding: "utf8" }).trim()));
  const fixtureCandidateCommonDir = realpathSync(path.resolve(fixture.candidate, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: fixture.candidate, encoding: "utf8" }).trim()));
  assert.equal(fixtureCandidateCommonDir, fixtureRepoCommonDir, "the fixture repository and the fixture candidate worktree must share one Git common directory");
  assertDisjoint("fixture Git common directory", fixtureRepoCommonDir, [
    ["the actual candidate/main checkout Git common directory", gitCommonDir],
    ["the live martianrover workspace", liveWorkspacePath]
  ]);

  const db = openDatabase(fixture.workspace);
  const records: Array<{ step: string; receipt?: CandidatePreservationReceipt; refused?: string }> = [];
  let timer: NodeJS.Timeout | undefined;
  try {
    processPreservationRequests(db, fixture.workspace);
    timer = setInterval(() => processPreservationRequests(db, fixture.workspace), 100);

    const reservation = db.prepare("SELECT id FROM agent_worktree_reservations WHERE worktree_path = ?").get(fixture.candidate) as { id: string } | undefined;
    if (!reservation) throw new Error("Fixture did not register the expected manual worktree reservation.");

    // 1. Initial capture, real restricted host validation (macOS Seatbelt).
    const initial = (await capture(fixture)).data.receipt;
    records.push({ step: "initial-capture", receipt: initial });
    assert.equal(initial.preservationState, "LOCAL ONLY");
    assert.equal(initial.authorityKind, "manual_handoff");
    assert.equal(initial.replayed, false);
    assert.equal((db.prepare("SELECT count(*) AS n FROM agent_sessions").get() as { n: number }).n, 0, "manual fixture must register zero managed Sessions");
    const evidence = latestValidationEvidence(fixture.workspace, reservation.id);
    assert.equal(evidence.complete, true, "Seatbelt validator did not report complete");
    assert.ok(evidence.results.length > 0 && evidence.results.every((r) => r.exitStatus === 0), "Seatbelt validator did not report passed");

    // 2. Unchanged replay returns the exact original receipt.
    const replay1 = (await capture(fixture)).data.receipt;
    records.push({ step: "unchanged-replay", receipt: replay1 });
    assert.equal(replay1.replayed, true);
    assert.equal(replay1.id, initial.id);
    assert.equal(replay1.commitSha, initial.commitSha);

    // 3. A harmless documentation change produces a changed tree/receipt.
    mkdirSync(path.join(fixture.candidate, "docs"), { recursive: true });
    writeFileSync(path.join(fixture.candidate, "docs", "revision.md"), "Harmless documentation revision for the baseline-symlink proof.\n");
    const revised = (await capture(fixture)).data.receipt;
    records.push({ step: "harmless-doc-change", receipt: revised });
    assert.notEqual(revised.commitSha, initial.commitSha);
    assert.notEqual(revised.candidateFingerprint, initial.candidateFingerprint);
    assert.equal(revised.replayed, false);

    // 4. ...and that revised state also replays unchanged.
    const replay2 = (await capture(fixture)).data.receipt;
    records.push({ step: "unchanged-replay-after-doc-change", receipt: replay2 });
    assert.equal(replay2.replayed, true);
    assert.equal(replay2.id, revised.id);
    assert.equal(replay2.commitSha, revised.commitSha);

    // 5. A changed (retargeted) baseline symlink refuses, leaving the real
    // index bytes and HEAD exactly as they were going into the attempt.
    const skillLink = path.join(fixture.candidate, "skill-link");
    rmSync(skillLink);
    symlinkSync("/tmp", skillLink);
    const beforeRetarget = indexSnapshot(fixture.candidate);
    const retargetRefusal = await expectRefusal(fixture, /regular candidate files/, "retargeted baseline symlink");
    records.push({ step: "retargeted-symlink-refused", refused: retargetRefusal });
    assertUntouched(beforeRetarget, indexSnapshot(fixture.candidate), "a refused retarget");
    rmSync(skillLink);
    symlinkSync("shared-skill", skillLink);
    const recovered1 = (await capture(fixture)).data.receipt;
    records.push({ step: "recovered-after-retarget-refusal", receipt: recovered1 });
    assert.equal(recovered1.replayed, true);
    assert.equal(recovered1.id, revised.id);

    // 6. An ancestor-directory escape for a baseline symlink's own path
    // refuses the same way, also leaving the real index and HEAD untouched.
    const nested = path.join(fixture.candidate, "nested");
    rmSync(nested, { recursive: true, force: true });
    symlinkSync("/tmp", nested);
    const beforeAncestorEscape = indexSnapshot(fixture.candidate);
    const ancestorEscapeRefusal = await expectRefusal(fixture, /regular candidate files/, "ancestor-directory escape");
    records.push({ step: "ancestor-escape-refused", refused: ancestorEscapeRefusal });
    assertUntouched(beforeAncestorEscape, indexSnapshot(fixture.candidate), "a refused ancestor escape");
    rmSync(nested, { force: true });
    mkdirSync(nested, { recursive: true });
    symlinkSync("../shared-skill", path.join(nested, "skill-link"));
    const recovered2 = (await capture(fixture)).data.receipt;
    records.push({ step: "recovered-after-ancestor-escape-refusal", receipt: recovered2 });
    assert.equal(recovered2.replayed, true);
    assert.equal(recovered2.id, revised.id);

    // 7. An unsafe regular-file input -- a tracked regular path replaced by a
    // symlink on disk -- refuses exactly as the privileged reader always has.
    const readme = path.join(fixture.candidate, "shared-skill", "README.md");
    rmSync(readme);
    symlinkSync("/etc/hostname", readme);
    const beforeUnsafeRegular = indexSnapshot(fixture.candidate);
    const unsafeRegularRefusal = await expectRefusal(fixture, /regular candidate files/, "unsafe regular-file input (symlink masquerading as a tracked file)");
    records.push({ step: "unsafe-regular-input-refused", refused: unsafeRegularRefusal });
    assertUntouched(beforeUnsafeRegular, indexSnapshot(fixture.candidate), "a refused unsafe regular input");
    rmSync(readme);
    writeFileSync(readme, "shared skill\n");
    const recovered3 = (await capture(fixture)).data.receipt;
    records.push({ step: "recovered-after-unsafe-regular-input-refusal", receipt: recovered3 });
    assert.equal(recovered3.replayed, true);
    assert.equal(recovered3.id, revised.id);

    // 8. A brand-new symlink -- never a baseline path, never previously
    // tracked -- is not a retarget of any trusted entry; it falls straight
    // through to the privileged reader like any other symlink and refuses
    // the same way, also leaving the real index bytes and HEAD untouched.
    const newSymlink = path.join(fixture.candidate, "new-symlink");
    symlinkSync("/tmp", newSymlink);
    const beforeNewSymlink = indexSnapshot(fixture.candidate);
    const newSymlinkRefusal = await expectRefusal(fixture, /regular candidate files/, "new untracked symlink");
    records.push({ step: "new-symlink-refused", refused: newSymlinkRefusal });
    assertUntouched(beforeNewSymlink, indexSnapshot(fixture.candidate), "a refused new untracked symlink");
    rmSync(newSymlink);
    const recovered4 = (await capture(fixture)).data.receipt;
    records.push({ step: "recovered-after-new-symlink-refusal", receipt: recovered4 });
    assert.equal(recovered4.replayed, true);
    assert.equal(recovered4.id, revised.id);

    const summary = {
      status: "passed" as const,
      kind: "disposable hermetic OS-boundary proof; no coding model, no remote effects, manual local-only preservation",
      launcher: LAUNCHER,
      fixture: { root: fixture.root, repo: fixture.repo, candidate: fixture.candidate, workspace: fixture.workspace },
      distinctnessCheckedAgainst: { thisCandidateRoot, mainCheckoutRoot, liveWorkspacePath, gitCommonDir, fixtureRepoCommonDir },
      reservationId: reservation.id,
      seatbeltValidation: evidence,
      checks: [
        "literal installed no-argument preserve-broker-claude launcher; current source runs the actual preservation",
        "fixture repo and fixture candidate share one Git common directory, disjoint from the real candidate/main checkout's and the live workspace",
        "initial capture passed real restricted host (Seatbelt) validation",
        "unchanged replay returns the identical receipt",
        "a harmless documentation change produces a changed tree/receipt, which itself then replays unchanged",
        "a retargeted baseline symlink refuses and leaves the real index bytes and HEAD untouched",
        "an ancestor-directory escape refuses and leaves the real index bytes and HEAD untouched",
        "an unsafe regular-file input (symlink masquerading as a tracked file) refuses and leaves the real index bytes and HEAD untouched",
        "a brand-new untracked symlink (never a baseline path) refuses and leaves the real index bytes and HEAD untouched",
        "every refusal recovers to the exact prior receipt once the candidate is restored",
        "manual handoff only; preservationState is LOCAL ONLY throughout; zero agent_sessions rows"
      ],
      scopeNote:
        "This harness proves the 'unsafe' shape of refused regular input (a symlink masquerading as a " +
        "tracked regular file) at the real OS boundary. The 'raced' shape -- a regular input's content " +
        "changing during validation -- is proven deterministically by the existing fast unit tests in " +
        "tests/preservation-validation.test.ts: 'refuses worktree mutation during validation even though " +
        "the immutable snapshot passes' and 'refuses changes between validation and preservation', both of " +
        "which mutate marker.txt (a tracked regular file, not a symlink) mid-validation and expect the " +
        "refusal; forcing a true race through the asynchronous host IPC path this harness exercises would " +
        "not be reliable or deterministic without an internal test-only hook that does not exist on this " +
        "path, so it is named here rather than silently skipped.",
      knownRisk:
        "The installed launcher's own transport half (submitting the request, reading PRESERVATION_REQUEST_FILE) " +
        "runs whatever broker revision happens to be installed. If that predates the current request filename " +
        "or shape, every capture() above fails closed with a timeout/refusal rather than silently passing; " +
        "run `arcadia go-broker status` first if so.",
      records
    };
    const summaryPath = path.join(fixture.root, "baseline-symlink-preservation-proof.json");
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ status: "passed", summaryPath, fixtureRoot: fixture.root, checks: summary.checks }, null, 2));
  } catch (error) {
    const failurePath = path.join(fixture.root, `baseline-symlink-preservation-failure-${Date.now()}.json`);
    writeFileSync(failurePath, JSON.stringify({ error: String(error), stack: error instanceof Error ? error.stack : null, records }, null, 2));
    process.stderr.write(`Baseline-symlink preservation proof failed; fixture and diagnostics retained: ${failurePath}\n`);
    throw error;
  } finally {
    if (timer) clearInterval(timer);
    db.close();
    // The disposable fixture itself is never deleted: it is this proof's receipt.
  }
}

await main();
