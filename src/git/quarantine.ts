import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync
} from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { git, tryGit } from "./worktrees.js";

/**
 * Retiring a worktree or branch by quarantine, not deletion.
 *
 * `arcadia tidy --apply` used to delete branches (`git branch -d`, falling
 * back to an `archive/tidy/<sha>` tag plus a forced `update-ref -d`) and
 * worktrees (`git worktree remove` / `git worktree prune`). Both are
 * information-preserving only by convention -- a wrong verdict, an untracked
 * gitignored file, or a detached HEAD with unreachable commits was
 * permanently gone. Quarantine instead relocates everything a retirement
 * would otherwise discard into a recoverable location under this
 * repository's own `.git` directory, keyed by a `<run>` id, so
 * `arcadia tidy undo <run>` can restore it byte-for-byte.
 *
 * Every quarantine op writes its own manifest entry before returning
 * success, so a crash mid-run leaves a manifest that accounts for exactly
 * what has (and has not yet) been quarantined. A worktree quarantine also
 * moves two directories that cannot rename atomically together, so an
 * fsynced journal entry precedes each op and {@link recoverTidyJournals}
 * settles anything left unfinished the next time tidy runs -- see the
 * journal section below for how.
 */

export interface QuarantinedBranch {
  branch: string;
  /** The branch tip at the moment of retirement. */
  oldTip: string;
  /** Where the branch's history was relocated: `refs/arcadia/tidy/<run>/heads/<branch>`. */
  quarantineRef: string;
}

export interface QuarantinedWorktree {
  /** The worktree's original, absolute path. */
  worktreePath: string;
  /** Full ref the worktree held, or null when detached. */
  branch: string | null;
  /** The worktree's HEAD commit at the moment of retirement. */
  head: string;
  /** `.git/worktrees/<id>`'s basename. */
  worktreeId: string;
  /** Where the HEAD commit was pinned so gc cannot reclaim it: `refs/arcadia/tidy/<run>/worktrees/<id>`. */
  pinRef: string;
  /** Whether a live worktree directory existed and was moved (false for an already-missing worktree, where only the admin directory is quarantined). */
  treeMoved: boolean;
  /** Where both halves were relocated to, under the repository's common `.git` directory. */
  quarantineDir: string;
}

export interface TidyQuarantineManifest {
  run: string;
  createdAt: string;
  branches: QuarantinedBranch[];
  worktrees: QuarantinedWorktree[];
}

/** A run id: sortable, filesystem- and ref-path-safe. */
export function createTidyRunId(now: Date = new Date()): string {
  return now.toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z").toLowerCase();
}

export function gitCommonDir(repoRoot: string): string {
  return git(repoRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
}

function quarantineRunRoot(commonDir: string, run: string): string {
  return path.join(commonDir, "arcadia-tidy", "quarantine", run);
}

function manifestPath(commonDir: string, run: string): string {
  return path.join(quarantineRunRoot(commonDir, run), "manifest.json");
}

function readManifest(commonDir: string, run: string): TidyQuarantineManifest {
  const file = manifestPath(commonDir, run);
  if (!existsSync(file)) {
    return { run, createdAt: new Date().toISOString(), branches: [], worktrees: [] };
  }
  return JSON.parse(readFileSync(file, "utf8")) as TidyQuarantineManifest;
}

function writeManifest(commonDir: string, run: string, manifest: TidyQuarantineManifest): void {
  mkdirSync(quarantineRunRoot(commonDir, run), { recursive: true });
  writeFileSync(manifestPath(commonDir, run), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Every manifest of a run that still exists, newest first. */
export function listTidyRuns(repoRoot: string): TidyQuarantineManifest[] {
  const commonDir = gitCommonDir(repoRoot);
  const root = path.join(commonDir, "arcadia-tidy", "quarantine");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(manifestPath(commonDir, name)))
    .map((name) => readManifest(commonDir, name))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readTidyRun(repoRoot: string, run: string): TidyQuarantineManifest | null {
  const commonDir = gitCommonDir(repoRoot);
  return existsSync(manifestPath(commonDir, run)) ? readManifest(commonDir, run) : null;
}

/**
 * The crash-recovery journal.
 *
 * A branch quarantine is one atomic `git update-ref --stdin` transaction, but
 * a worktree quarantine is not: it pins a ref, then renames two directories,
 * then writes the manifest -- four steps a crash (or, for these tests, an
 * injected fault) can land between. Before any of those steps runs, tidy
 * writes a `begin` line here naming everything needed to finish or discard the
 * step, and fsyncs it -- so the record of "this was in flight" survives even
 * when the step itself does not. A `done` line, written only once every
 * physical step and the manifest write above have actually landed, is what
 * lets the next tidy invocation tell a finished op from one that crashed.
 *
 * Nothing here decides *whether* to roll forward or back: {@link
 * recoverTidyJournals} decides that once, per op, from what is actually on
 * disk, and this module never re-derives it from guesswork.
 */

interface BranchJournalOp {
  op: "branch";
  id: string;
  run: string;
  branch: string;
  expectedTip: string;
  quarantineRef: string;
}

interface WorktreeJournalOp {
  op: "worktree";
  id: string;
  run: string;
  worktreeId: string;
  pinRef: string;
  head: string;
  worktreePath: string;
  branch: string | null;
  adminDirOriginal: string;
  treeDest: string;
  adminDest: string;
  /** Whether the worktree's directory was already gone when this op began (no tree half to move). */
  missing: boolean;
}

type JournalOp = BranchJournalOp | WorktreeJournalOp;
type JournalLine = ({ phase: "begin" } & JournalOp) | { phase: "done"; id: string; run: string };

function journalDir(commonDir: string): string {
  return path.join(commonDir, "arcadia-tidy", "journal");
}

function journalFile(commonDir: string, run: string): string {
  return path.join(journalDir(commonDir), `${run}.ndjson`);
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Append one line and fsync it before returning, so the write is durable on
 * disk the moment this call returns -- not merely handed to a buffer the OS
 * might still be holding when the process dies. Fsyncing the file descriptor
 * makes the line's own bytes durable but not the directory entry that makes
 * the file findable at all; the first line of a run additionally fsyncs the
 * directory it just created the file in (and that directory's own parent, if
 * this call is what created the directory too), so a power loss can never
 * leave a step committed with no journal file to show for it.
 */
function appendJournalLine(commonDir: string, run: string, line: JournalLine): void {
  const dir = journalDir(commonDir);
  const dirAlreadyExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true });
  const file = journalFile(commonDir, run);
  const fileAlreadyExisted = existsSync(file);

  const fd = openSync(file, "a");
  try {
    writeSync(fd, `${JSON.stringify(line)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  if (!fileAlreadyExisted) {
    fsyncDir(dir);
    if (!dirAlreadyExisted) fsyncDir(path.dirname(dir));
  }
}

/**
 * Parse every line, tolerating exactly one failure mode: a crash mid-`write`
 * tearing the final line in half. That torn line is necessarily a `begin`
 * whose own fsync never happened, so nothing after it ever ran either --
 * dropping it loses no recoverable state. A malformed line anywhere else is
 * real corruption, not a torn write, and must not be silently discarded.
 */
function readJournalLines(file: string): JournalLine[] {
  const rawLines = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const parsed: JournalLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    try {
      parsed.push(JSON.parse(rawLines[i]) as JournalLine);
    } catch (error) {
      if (i === rawLines.length - 1) break;
      throw error;
    }
  }
  return parsed;
}

function refExists(repoRoot: string, ref: string): boolean {
  return tryGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]) !== null;
}

function ensureBranchManifestEntry(commonDir: string, run: string, entry: QuarantinedBranch): void {
  const manifest = readManifest(commonDir, run);
  if (manifest.branches.some((candidate) => candidate.branch === entry.branch)) return;
  manifest.branches.push(entry);
  writeManifest(commonDir, run, manifest);
}

function ensureWorktreeManifestEntry(commonDir: string, run: string, entry: QuarantinedWorktree): void {
  const manifest = readManifest(commonDir, run);
  if (manifest.worktrees.some((candidate) => candidate.worktreeId === entry.worktreeId)) return;
  manifest.worktrees.push(entry);
  writeManifest(commonDir, run, manifest);
}

/**
 * Finish or discard one interrupted branch op, purely from what git reports
 * now. The ref transaction that does the actual work is atomic, so there are
 * only two reachable states: it happened (the quarantine ref exists) or it
 * never did (the live branch ref is still there, untouched).
 */
function recoverBranchOp(repoRoot: string, commonDir: string, begin: BranchJournalOp): "forward" | "back" {
  if (!refExists(repoRoot, begin.quarantineRef)) return "back";
  ensureBranchManifestEntry(commonDir, begin.run, { branch: begin.branch, oldTip: begin.expectedTip, quarantineRef: begin.quarantineRef });
  return "forward";
}

/**
 * Finish or discard one interrupted worktree op.
 *
 * The pin ref is the first atomic step, but it alone is not "real progress":
 * recovery runs at the start of *every* tidy invocation, including a plain
 * preview, and before the write interlock that would otherwise re-check
 * whether a Session has since leased the worktree, a process now has it as
 * its cwd, or someone has resumed work in it. Finishing the move on the
 * strength of the pin alone would relocate a worktree nobody has re-assessed
 * since the crash. Once at least one of the two renames has actually landed
 * the calculus flips: both halves already sit wherever they sit, and finishing
 * the (idempotent) move is strictly safe and loses nothing. So "forward" is
 * the answer only once real filesystem progress exists to protect; "back" —
 * dropping the orphan pin — is the answer whenever nothing has moved yet,
 * pin included.
 */
function recoverWorktreeOp(repoRoot: string, commonDir: string, begin: WorktreeJournalOp): "forward" | "back" {
  if (!refExists(repoRoot, begin.pinRef)) return "back";

  const anyRenameLanded = existsSync(begin.treeDest) || existsSync(begin.adminDest);
  if (!anyRenameLanded) {
    tryGit(repoRoot, ["update-ref", "-d", begin.pinRef]);
    return "back";
  }

  if (!begin.missing && existsSync(begin.worktreePath) && !existsSync(begin.treeDest)) {
    renameOntoQuarantine(begin.worktreePath, begin.treeDest);
  }
  if (existsSync(begin.adminDirOriginal) && !existsSync(begin.adminDest)) {
    renameOntoQuarantine(begin.adminDirOriginal, begin.adminDest);
  }

  ensureWorktreeManifestEntry(commonDir, begin.run, {
    worktreePath: begin.worktreePath,
    branch: begin.branch,
    head: begin.head,
    worktreeId: begin.worktreeId,
    pinRef: begin.pinRef,
    treeMoved: !begin.missing,
    quarantineDir: path.dirname(begin.adminDest)
  });
  return "forward";
}

export interface TidyJournalRecovery {
  /** Human-readable description of each interrupted op that was finished. */
  rolledForward: string[];
  /** Human-readable description of each interrupted op that never actually started, and needed nothing. */
  rolledBack: string[];
  /** Ops that still could not be resolved (e.g. a persistent EXDEV/EACCES) -- left open for the next attempt, and reported rather than blocking every later tidy invocation. */
  failed: string[];
}

/**
 * Resolve every quarantine op left in flight by a previous `tidy --apply` that
 * never reached its `done` line -- a crash, a killed process, or (for these
 * tests) an injected fault. Deterministic and idempotent: run it as many
 * times as you like, including with nothing to recover, and it settles into
 * the same end state and writes each op's `done` line at most once.
 *
 * Called at the start of every `tidy` invocation, preview or apply, because an
 * interrupted run's damage belongs to whoever crashed it, not to whichever
 * command happens to run next. Each op is resolved independently: one that
 * keeps failing (a permanently unwritable filesystem, a persistently occupied
 * destination) is reported and left open rather than throwing out of this
 * function and taking every later tidy invocation down with it.
 */
export function recoverTidyJournals(repoRoot: string): TidyJournalRecovery {
  const commonDir = gitCommonDir(repoRoot);
  const dir = journalDir(commonDir);
  const result: TidyJournalRecovery = { rolledForward: [], rolledBack: [], failed: [] };
  if (!existsSync(dir)) return result;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ndjson")) continue;
    const run = file.slice(0, -".ndjson".length);
    const filePath = path.join(dir, file);
    const lines = readJournalLines(filePath);
    const begins = new Map<string, JournalOp>();
    const resolved = new Set<string>();
    for (const line of lines) {
      if (line.phase === "begin") begins.set(line.id, line);
      else resolved.add(line.id);
    }
    for (const [id, begin] of begins) {
      if (resolved.has(id)) continue;
      const label = begin.op === "branch" ? `branch ${begin.branch} (run ${run})` : `worktree ${begin.worktreePath} (run ${run})`;
      try {
        const outcome =
          begin.op === "branch" ? recoverBranchOp(repoRoot, commonDir, begin) : recoverWorktreeOp(repoRoot, commonDir, begin);
        (outcome === "forward" ? result.rolledForward : result.rolledBack).push(label);
        appendJournalLine(commonDir, run, { phase: "done", id, run });
        resolved.add(id);
      } catch (error) {
        result.failed.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Fully settled the moment every begin in this file has a matching
    // resolution -- drop it here rather than waiting for `finalizeTidyJournal`,
    // which only ever looks at the current invocation's own run id.
    if ([...begins.keys()].every((id) => resolved.has(id))) {
      try {
        rmSync(filePath, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
  return result;
}

/**
 * Drop a run's journal file once every op it recorded has reached `done` --
 * it has finished doing its job and would otherwise accumulate forever. A run
 * with anything still dangling (a genuinely failed quarantine attempt tidy
 * itself already reported, not merely an old, fully-resolved one) is left
 * alone: {@link recoverTidyJournals} still needs it on the next invocation.
 */
export function finalizeTidyJournal(repoRoot: string, run: string): void {
  const commonDir = gitCommonDir(repoRoot);
  const file = journalFile(commonDir, run);
  if (!existsSync(file)) return;
  const lines = readJournalLines(file);
  const doneIds = new Set(lines.filter((line) => line.phase === "done").map((line) => line.id));
  const allDone = lines.filter((line) => line.phase === "begin").every((line) => doneIds.has(line.id));
  if (allDone) rmSync(file, { force: true });
}

/**
 * Whether a path is reachable at all, distinguishing three states a plain
 * `existsSync` collapses into one: present, provably gone (`ENOENT`/`ENOTDIR`
 * -- ordinary `git worktree prune` territory), or merely unreachable right
 * now (`ENXIO`/`ESTALE`/`EIO`/`EACCES` -- a disconnected or unmounted
 * volume, or a permission problem). Only the second is safe to treat as
 * "missing"; the third must refuse rather than guess, since the path may
 * still hold real, unquarantined work once it reappears.
 */
export function probePath(target: string): "present" | "missing" | "unavailable" {
  try {
    statSync(target);
    return "present";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unavailable";
  }
}

function renameOntoQuarantine(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EXDEV") {
      throw validationError(
        `Cannot quarantine "${from}": it sits on a different filesystem than this repository's ".git" directory, and Arcadia refuses to copy across filesystems.`,
        { from, to }
      );
    }
    throw error;
  }
}

/**
 * Retire one branch by relocating its history, not deleting it.
 *
 * One `git update-ref --stdin` transaction verifies the branch's current tip,
 * creates `refs/arcadia/tidy/<run>/heads/<branch>` pointing at it, and deletes
 * `refs/heads/<branch>` -- atomically: if the branch moved since `expectedTip`
 * was read, the whole transaction is refused and nothing changes. This
 * replaces both the old `git branch -d` shortcut and the old
 * `archive/tidy/<sha>` tag: a tag is a second, independent naming scheme that
 * has to be separately discovered and cleaned up, where a `refs/arcadia/tidy/`
 * namespace is self-describing and scoped to exactly the run that created it.
 *
 * `update-ref --stdin` moves the ref pointer but not its reflog file, so the
 * branch's reflog is copied onto the new ref's own (freshly-created) reflog
 * before returning, preserving its full history rather than losing it to the
 * one-line "created" entry the transaction itself would otherwise leave.
 */
export function quarantineBranch(
  repoRoot: string,
  branch: string,
  run: string,
  /** The tip to require as the CAS "old value", when a caller already resolved it (e.g. before injecting a test race). Resolved fresh when omitted. */
  knownTip?: string,
  /** Deterministic fault injection for race regression tests. Not exposed by the CLI. */
  testHooks?: { beforeRefTransaction?: () => void; afterRefTransaction?: () => void }
): QuarantinedBranch | null {
  const expectedTip = knownTip ?? tryGit(repoRoot, ["rev-parse", `refs/heads/${branch}^{commit}`])?.trim();
  if (!expectedTip) return null;

  const commonDir = gitCommonDir(repoRoot);
  const quarantineRef = `refs/arcadia/tidy/${run}/heads/${branch}`;
  const id = `branch:${run}:${branch}`;
  const oldReflogPath = path.join(commonDir, "logs", "refs", "heads", branch);
  const oldReflog = existsSync(oldReflogPath) ? readFileSync(oldReflogPath, "utf8") : null;

  appendJournalLine(commonDir, run, { phase: "begin", op: "branch", id, run, branch, expectedTip, quarantineRef });
  testHooks?.beforeRefTransaction?.();

  const script = `start\ncreate ${quarantineRef} ${expectedTip}\ndelete refs/heads/${branch} ${expectedTip}\ncommit\n`;
  const result = spawnSync("git", ["update-ref", "--stdin"], { cwd: repoRoot, input: script, encoding: "utf8" });
  if (result.status !== 0) return null;

  testHooks?.afterRefTransaction?.();

  // The ref transaction above already committed: the branch is quarantined
  // whether or not anything below succeeds. The manifest entry is written
  // immediately, before the best-effort reflog copy, so a crash never leaves
  // a quarantined ref `tidy list`/`tidy undo` cannot find -- and if it does
  // anyway (the process dies between the two lines below), the next tidy
  // invocation's journal recovery reconstructs this same entry from the
  // quarantine ref alone.
  const entry: QuarantinedBranch = { branch, oldTip: expectedTip, quarantineRef };
  const manifest = readManifest(commonDir, run);
  manifest.branches.push(entry);
  writeManifest(commonDir, run, manifest);

  if (oldReflog) {
    const newReflogPath = path.join(commonDir, "logs", "refs", "arcadia", "tidy", run, "heads", branch);
    const freshEntry = existsSync(newReflogPath) ? readFileSync(newReflogPath, "utf8") : "";
    mkdirSync(path.dirname(newReflogPath), { recursive: true });
    writeFileSync(newReflogPath, oldReflog + freshEntry);
  }

  appendJournalLine(commonDir, run, { phase: "done", id, run });
  return entry;
}

/** Reverse of {@link quarantineBranch}: restores `refs/heads/<branch>` at its original tip, with its reflog. */
function restoreBranch(repoRoot: string, entry: QuarantinedBranch): boolean {
  const commonDir = gitCommonDir(repoRoot);
  const currentTip = tryGit(repoRoot, [`rev-parse`, `${entry.quarantineRef}^{commit}`])?.trim();
  if (currentTip !== entry.oldTip) return false;
  if (tryGit(repoRoot, ["show-ref", "--verify", `refs/heads/${entry.branch}`]) !== null) return false;

  // Read before the transaction: the `delete` verb below removes the
  // quarantine ref's own reflog file along with the ref itself, exactly as
  // `quarantineBranch` reads the branch's original reflog before the
  // transaction that would otherwise delete it out from under this code.
  const quarantineRun = entry.quarantineRef.split("/")[3];
  const quarantineReflogPath = path.join(commonDir, "logs", "refs", "arcadia", "tidy", quarantineRun, "heads", entry.branch);
  const quarantineReflog = existsSync(quarantineReflogPath) ? readFileSync(quarantineReflogPath, "utf8") : null;

  const script = `start\ncreate refs/heads/${entry.branch} ${entry.oldTip}\ndelete ${entry.quarantineRef} ${entry.oldTip}\ncommit\n`;
  const result = spawnSync("git", ["update-ref", "--stdin"], { cwd: repoRoot, input: script, encoding: "utf8" });
  if (result.status !== 0) return false;

  if (quarantineReflog) {
    const restoredReflogPath = path.join(commonDir, "logs", "refs", "heads", entry.branch);
    const freshEntry = existsSync(restoredReflogPath) ? readFileSync(restoredReflogPath, "utf8") : "";
    mkdirSync(path.dirname(restoredReflogPath), { recursive: true });
    writeFileSync(restoredReflogPath, quarantineReflog + freshEntry);
  }
  return true;
}

/** The `.git/worktrees/<id>` admin directory for `worktreePath`, resolved from a live worktree. */
export function adminDirFor(worktreePath: string): string | null {
  return tryGit(worktreePath, ["rev-parse", "--absolute-git-dir"]);
}

/**
 * The `.git/worktrees/<id>` admin directory for a worktree whose directory no
 * longer exists, found by scanning every registered admin directory's
 * `gitdir` file (which names the worktree's `.git` gitfile path) for the one
 * that matches. `git worktree list` still reports such a worktree; nothing
 * about its own path can be queried directly since it is gone.
 */
export function findAdminDirForMissingWorktree(commonDir: string, worktreePath: string): string | null {
  const worktreesDir = path.join(commonDir, "worktrees");
  if (!existsSync(worktreesDir)) return null;
  const target = path.resolve(worktreePath, ".git");
  for (const id of readdirSync(worktreesDir)) {
    const gitdirFile = path.join(worktreesDir, id, "gitdir");
    if (!existsSync(gitdirFile)) continue;
    const declared = readFileSync(gitdirFile, "utf8").trim();
    if (path.resolve(declared) === target) return path.join(worktreesDir, id);
  }
  return null;
}

/**
 * Retire one worktree by pinning its HEAD, then relocating both halves of it,
 * rather than removing or pruning it.
 *
 * `refs/arcadia/tidy/<run>/worktrees/<id>` is created first and always,
 * before either directory moves: it is what keeps the worktree's HEAD commit
 * reachable once `.git/worktrees/<id>` is moved out of the location git's own
 * garbage collector scans for live worktree HEADs -- without it, a detached
 * HEAD whose commits no other ref contains would become collectible the
 * moment its admin directory moved. The worktree directory itself (its full
 * file tree, including gitignored files -- this is a plain directory rename,
 * not a git operation) and its `.git/worktrees/<id>` admin directory are then
 * both renamed into the same `<run>/<id>/` quarantine location, verbatim and
 * uninspected, so `undo` can put both back exactly where they were with two
 * more renames and nothing else to reconcile.
 *
 * An already-missing worktree (its directory is gone, but git still
 * registers it) has no tree to move -- only its admin directory, found via
 * {@link findAdminDirForMissingWorktree} -- which is exactly the case the old
 * `git worktree prune` discarded outright.
 */
export function quarantineWorktree(
  repoRoot: string,
  entry: { path: string; branch: string | null; head: string },
  run: string,
  /** Deterministic fault injection for race regression tests. Not exposed by the CLI. */
  testHooks?: { afterPin?: () => void; afterTreeMove?: () => void; afterAdminMove?: () => void }
): QuarantinedWorktree | null {
  const commonDir = gitCommonDir(repoRoot);
  const presence = probePath(entry.path);
  if (presence === "unavailable") {
    throw validationError(
      `Cannot quarantine worktree "${entry.path}": its path is unreachable (possibly an unmounted or disconnected volume), not provably absent.`,
      { path: entry.path }
    );
  }
  const missing = presence === "missing";

  let adminDir: string | null;
  let head = entry.head;
  if (!missing) {
    adminDir = adminDirFor(entry.path);
    const currentHead = tryGit(entry.path, ["rev-parse", "HEAD"]);
    if (currentHead) head = currentHead.trim();
  } else {
    adminDir = findAdminDirForMissingWorktree(commonDir, entry.path);
  }
  if (!adminDir) return null;

  const worktreeId = path.basename(adminDir);
  const pinRef = `refs/arcadia/tidy/${run}/worktrees/${worktreeId}`;
  const quarantineDir = path.join(quarantineRunRoot(commonDir, run), worktreeId);
  const treeDest = path.join(quarantineDir, "worktree");
  const adminDest = path.join(quarantineDir, "admin");
  const id = `worktree:${run}:${worktreeId}`;

  appendJournalLine(commonDir, run, {
    phase: "begin",
    op: "worktree",
    id,
    run,
    worktreeId,
    pinRef,
    head,
    worktreePath: entry.path,
    branch: entry.branch,
    adminDirOriginal: adminDir,
    treeDest,
    adminDest,
    missing
  });

  if (tryGit(repoRoot, ["update-ref", pinRef, head]) === null) return null;
  testHooks?.afterPin?.();

  if (!missing) renameOntoQuarantine(entry.path, treeDest);
  testHooks?.afterTreeMove?.();
  renameOntoQuarantine(adminDir, adminDest);
  testHooks?.afterAdminMove?.();

  const result: QuarantinedWorktree = {
    worktreePath: entry.path,
    branch: entry.branch,
    head,
    worktreeId,
    pinRef,
    treeMoved: !missing,
    quarantineDir
  };
  const manifest = readManifest(commonDir, run);
  manifest.worktrees.push(result);
  writeManifest(commonDir, run, manifest);
  appendJournalLine(commonDir, run, { phase: "done", id, run });
  return result;
}

/** Reverse of {@link quarantineWorktree}: renames both halves back to their original locations and drops the pin. */
function restoreWorktree(repoRoot: string, entry: QuarantinedWorktree): boolean {
  const treeSrc = path.join(entry.quarantineDir, "worktree");
  const adminSrc = path.join(entry.quarantineDir, "admin");
  if (!existsSync(adminSrc)) return false;
  if (entry.treeMoved && !existsSync(treeSrc)) return false;
  if (entry.treeMoved && existsSync(entry.worktreePath)) return false;

  if (entry.treeMoved) renameOntoQuarantine(treeSrc, entry.worktreePath);
  const commonDir = gitCommonDir(repoRoot);
  const adminDest = path.join(commonDir, "worktrees", entry.worktreeId);
  try {
    renameOntoQuarantine(adminSrc, adminDest);
  } catch (error) {
    // The tree already moved but the admin directory didn't: roll the tree
    // back to the quarantine directory so this entry's on-disk state still
    // matches what its (retained, since this throws and the caller records
    // the entry as failed) manifest entry describes, and a retry starts from
    // the same clean quarantined state rather than a half-restored one.
    if (entry.treeMoved) {
      try { renameOntoQuarantine(entry.worktreePath, treeSrc); } catch { /* best effort */ }
    }
    throw error;
  }

  tryGit(repoRoot, ["update-ref", "-d", entry.pinRef]);
  try { rmSync(entry.quarantineDir, { recursive: true, force: true }); } catch { /* best effort */ }
  return true;
}

export interface TidyUndoResult {
  run: string;
  branchesRestored: string[];
  branchesFailed: string[];
  worktreesRestored: string[];
  worktreesFailed: string[];
}

/**
 * Restore every branch and worktree a `tidy --apply` run quarantined, exactly
 * to where they were: the manifest it wrote is the only input this needs, so
 * undo never has to re-derive or guess anything about the prior state.
 */
export function undoTidyRun(repoRoot: string, run: string): TidyUndoResult {
  const commonDir = gitCommonDir(repoRoot);
  const manifest = readTidyRun(repoRoot, run);
  if (!manifest) {
    throw validationError(`No quarantined tidy run "${run}" was found for this repository.`, { run });
  }

  // Each successful restore is persisted immediately, removing that entry
  // from the manifest, so a retry after a partial failure only ever
  // re-attempts what is still genuinely quarantined -- never an
  // already-restored branch or worktree whose original location a retry
  // would otherwise find occupied and misreport as newly failed. The
  // not-yet-attempted tail of each list is kept in every intermediate write
  // (never dropped), and each restore call is caught individually, so a
  // thrown error on one entry is recorded as that entry's failure rather than
  // abandoning the rest of the run -- and, critically, rather than losing the
  // still-quarantined tail from the persisted manifest entirely.
  let pendingBranches = [...manifest.branches];
  let pendingWorktrees = [...manifest.worktrees];
  const branchesRestored: string[] = [];
  const branchesFailed: string[] = [];
  for (const entry of manifest.branches) {
    let restored: boolean;
    try {
      restored = restoreBranch(repoRoot, entry);
    } catch {
      restored = false;
    }
    (restored ? branchesRestored : branchesFailed).push(entry.branch);
    pendingBranches = restored ? pendingBranches.filter((candidate) => candidate !== entry) : pendingBranches;
    writeManifest(commonDir, run, { ...manifest, branches: pendingBranches, worktrees: pendingWorktrees });
  }

  const worktreesRestored: string[] = [];
  const worktreesFailed: string[] = [];
  for (const entry of manifest.worktrees) {
    let restored: boolean;
    try {
      restored = restoreWorktree(repoRoot, entry);
    } catch {
      restored = false;
    }
    (restored ? worktreesRestored : worktreesFailed).push(entry.worktreePath);
    pendingWorktrees = restored ? pendingWorktrees.filter((candidate) => candidate !== entry) : pendingWorktrees;
    writeManifest(commonDir, run, { ...manifest, branches: pendingBranches, worktrees: pendingWorktrees });
  }

  // A fully-restored run has nothing left to list or undo again; remove its
  // quarantine directory (including the manifest) so `tidy list` does not
  // keep offering a phantom run forever. A partial restore leaves the
  // (now-shrunk) manifest in place, since whatever failed is still
  // genuinely quarantined.
  if (branchesFailed.length === 0 && worktreesFailed.length === 0) {
    try { rmSync(quarantineRunRoot(commonDir, run), { recursive: true, force: true }); } catch { /* best effort */ }
  }

  return { run, branchesRestored, branchesFailed, worktreesRestored, worktreesFailed };
}
