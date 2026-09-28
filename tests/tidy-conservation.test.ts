import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTidyCommand, runTidyUndoCommand, type TidyCommandData } from "../src/commands/tidy.js";
import { createTidyRunId, quarantineWorktree, readTidyRun } from "../src/git/quarantine.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import type { CommandSuccess } from "../src/cli/response.js";

/**
 * `arcadia tidy --apply`'s whole safety case is one property: nothing it
 * touches is ever lost, whatever shape the repository happened to be in when
 * it ran. Rather than hand-pick a handful of shapes, this generates them from
 * a seed -- a repository carrying every merge proof tidy recognizes (ordinary
 * merge, squash, rebase), every worktree shape it classifies (clean, merged,
 * detached at a merged commit, detached at an unreachable one, a directory
 * deleted out from under its own registration), a gitignored file no `git
 * status` would ever mention, and one quarantine op deliberately crashed
 * partway through -- and then checks the one property that matters for all of
 * them at once: every commit and every file byte present before `--apply` is
 * still reachable (live or quarantined) after it, `tidy undo` puts it all back
 * exactly, and a second `--apply` retires nothing further.
 *
 * The seed drives incidental detail (file bytes, commit messages, which of two
 * equivalent worktrees gets the injected crash) through a small deterministic
 * PRNG; the structural coverage above is unconditional on every seed, so
 * running this with more seeds only exercises the same guarantee against more
 * incidental variation, never less coverage.
 */

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.ARCADIA_WORKSPACE;
});

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function data(result: CommandSuccess<TidyCommandData>): TidyCommandData {
  return result.data;
}

/** mulberry32: tiny, dependency-free, deterministic from an integer seed. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(rand: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(rand() * 36).toString(36);
  return out;
}

function repo(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-tidy-conservation-")));
  temporary.push(root);
  run(root, ["init", "--initial-branch=main", "--quiet"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "Test"]);
  writeFileSync(path.join(root, "README.md"), "# base\n", "utf8");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-q", "-m", "base"]);
  const workspace = workspaceFor(root);
  temporary.push(workspace);
  initWorkspace(workspace);
  process.env.ARCADIA_WORKSPACE = workspace;
  return root;
}

function workspaceFor(root: string): string {
  return path.join(path.dirname(root), `${path.basename(root)}-workspace`);
}

function commitFile(root: string, file: string, content: string, message: string): void {
  writeFileSync(path.join(root, file), content, "utf8");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-q", "-m", message]);
}

function worktreeAt(root: string, name: string, commitish: string, extraFlags: string[] = []): string {
  const target = path.join(root, "..", `${path.basename(root)}-${name}`);
  run(root, ["worktree", "add", "-q", ...extraFlags, target, commitish]);
  temporary.push(target);
  return realpathSync(target);
}

/** Every file under `dir` (excluding `.git`) as a relative-path -> sha256 map, including untracked and gitignored files. */
function snapshotFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string, rel: string): void => {
    for (const name of readdirSync(current)) {
      if (name === ".git") continue;
      const abs = path.join(current, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs, relPath);
      else files.set(relPath, createHash("sha256").update(readFileSync(abs)).digest("hex"));
    }
  };
  walk(dir, "");
  return files;
}

function expectSameFiles(before: Map<string, string>, after: Map<string, string>, label: string): void {
  expect([...after.keys()].sort(), `${label}: file set changed`).toEqual([...before.keys()].sort());
  for (const [relPath, hash] of before) {
    expect(after.get(relPath), `${label}: ${relPath} changed bytes`).toBe(hash);
  }
}

/** Every commit reachable from every local branch tip, every worktree's current HEAD (live or detached), and every quarantine ref this repository holds. */
function reachableCommits(root: string): Set<string> {
  const heads = run(root, ["for-each-ref", "--format=%(objectname)", "refs/heads"]).split("\n").filter(Boolean);
  const quarantined = run(root, ["for-each-ref", "--format=%(objectname)", "refs/arcadia/tidy"]).split("\n").filter(Boolean);
  const worktreeList = run(root, ["worktree", "list", "--porcelain"]);
  const worktreePaths = worktreeList
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((wt) => existsSync(wt));
  const worktreeHeads = worktreePaths.map((wt) => run(wt, ["rev-parse", "HEAD"]).trim());
  const roots = [...heads, ...quarantined, ...worktreeHeads];
  if (roots.length === 0) return new Set();
  return new Set(run(root, ["rev-list", ...roots]).trim().split("\n").filter(Boolean));
}

interface Scenario {
  root: string;
  /** Commits reachable, and worktree file bytes present, right before anything (including the injected race) runs. */
  beforeCommits: Set<string>;
  ignoredWorktree: string;
  ignoredWorktreeFiles: Map<string, string>;
  ignoredWorktreeHead: string;
  missingDirWorktree: string;
  detachedMergedWorktree: string;
  detachedMergedHead: string;
  detachedUnmergedWorktree: string;
  detachedUnmergedHead: string;
  mergedAncestryBranch: string;
  mergedAncestryTip: string;
  mergedSquashBranch: string;
  mergedRebaseBranch: string;
  unmergedBranch: string;
  unmergedTip: string;
}

/**
 * Build one repository carrying every shape this generator is required to
 * cover. The seed only perturbs incidental detail (byte content, which
 * worktree gets the injected crash) -- every category below is present on
 * every seed, so no amount of unlucky randomness ever silently drops
 * coverage.
 */
function buildScenario(seed: number): Scenario {
  const rand = mulberry32(seed);
  const root = repo();

  // Ordinary merge -- ancestry proof.
  const mergedAncestryBranch = "claude/merged-ancestry";
  run(root, ["checkout", "-q", "-b", mergedAncestryBranch]);
  commitFile(root, "ancestry.txt", `ancestry-${randomBytes(rand, 8)}\n`, "ancestry");
  run(root, ["checkout", "-q", "main"]);
  run(root, ["merge", "-q", "--no-ff", "-m", "merge ancestry", mergedAncestryBranch]);
  const mergedAncestryTip = run(root, ["rev-parse", mergedAncestryBranch]).trim();

  // Squash-style merge -- the branch's own commit never lands on main by
  // ancestry, but the same diff is committed to main directly, so `git
  // cherry` finds it patch-equivalent.
  const mergedSquashBranch = "claude/merged-squash";
  run(root, ["checkout", "-q", "-b", mergedSquashBranch]);
  const squashContent = `squash-${randomBytes(rand, 8)}\n`;
  commitFile(root, "squash.txt", squashContent, "squash source");
  run(root, ["checkout", "-q", "main"]);
  commitFile(root, "squash.txt", squashContent, "squash: squash source (#1)");

  // Rebase-style merge -- the branch is cut from an older base, then its
  // commit is replayed (cherry-picked) directly onto the advanced main,
  // exactly what a rebase-then-fast-forward leaves behind: patch-equivalent,
  // not an ancestor.
  const mergedRebaseBranch = "claude/merged-rebase";
  run(root, ["checkout", "-q", "-b", mergedRebaseBranch]);
  commitFile(root, "rebase.txt", `rebase-${randomBytes(rand, 8)}\n`, "rebase source");
  const rebaseSourceTip = run(root, ["rev-parse", mergedRebaseBranch]).trim();
  run(root, ["checkout", "-q", "main"]);
  commitFile(root, "advance.txt", `advance-${randomBytes(rand, 8)}\n`, "advance main");
  run(root, ["cherry-pick", rebaseSourceTip]);

  // Unmerged, no remote copy -- the "this is the only copy" case, and the
  // negative control every conservation check below must still hold for.
  const unmergedBranch = "claude/unmerged";
  run(root, ["checkout", "-q", "-b", unmergedBranch]);
  commitFile(root, "unmerged.txt", `unmerged-${randomBytes(rand, 8)}\n`, "unmerged work");
  const unmergedTip = run(root, ["rev-parse", unmergedBranch]).trim();
  run(root, ["checkout", "-q", "main"]);

  // A clean, merged worktree carrying a gitignored file `git status` never
  // reports -- byte conservation across a quarantine rename, not just
  // history conservation.
  const ignoredBranch = "claude/merged-worktree";
  run(root, ["checkout", "-q", "-b", ignoredBranch]);
  commitFile(root, "worktree.txt", `worktree-${randomBytes(rand, 8)}\n`, "worktree work");
  run(root, ["checkout", "-q", "main"]);
  run(root, ["merge", "-q", "--no-ff", "-m", "merge worktree", ignoredBranch]);
  const ignoredWorktree = worktreeAt(root, "ignored", ignoredBranch);
  writeFileSync(path.join(ignoredWorktree, ".gitignore"), "secret.local\n", "utf8");
  run(ignoredWorktree, ["add", ".gitignore"]);
  run(ignoredWorktree, ["commit", "-q", "-m", "ignore secret.local"]);
  writeFileSync(path.join(ignoredWorktree, "secret.local"), randomBytes(rand, 64), "utf8");
  const ignoredWorktreeFiles = snapshotFiles(ignoredWorktree);
  const ignoredWorktreeHead = run(ignoredWorktree, ["rev-parse", "HEAD"]).trim();

  // A registered worktree whose directory is already gone -- `probePath`
  // must call this "missing," not "unavailable" or a crash.
  const missingDirBranch = "claude/missing-dir";
  run(root, ["checkout", "-q", "-b", missingDirBranch]);
  commitFile(root, "missing.txt", `missing-${randomBytes(rand, 8)}\n`, "missing dir work");
  run(root, ["checkout", "-q", "main"]);
  run(root, ["merge", "-q", "--no-ff", "-m", "merge missing", missingDirBranch]);
  const missingDirWorktree = worktreeAt(root, "missing", missingDirBranch);
  rmSync(missingDirWorktree, { recursive: true, force: true });

  // Detached at a commit the base branch already contains -- retirable with
  // no branch to speak of.
  const detachedMergedHead = mergedAncestryTip;
  const detachedMergedWorktree = worktreeAt(root, "detached-merged", detachedMergedHead, ["--detach"]);

  // Detached at a commit the base branch does not contain and no surviving
  // branch names -- must never be touched, and its commit must still be
  // reachable afterward purely through this worktree's own HEAD.
  run(root, ["checkout", "-q", "-b", "tmp-unreachable"]);
  commitFile(root, "unreachable.txt", `unreachable-${randomBytes(rand, 8)}\n`, "unreachable work");
  const detachedUnmergedHead = run(root, ["rev-parse", "tmp-unreachable"]).trim();
  run(root, ["checkout", "-q", "main"]);
  const detachedUnmergedWorktree = worktreeAt(root, "detached-unmerged", detachedUnmergedHead, ["--detach"]);
  run(root, ["branch", "-D", "tmp-unreachable"]);

  const beforeCommits = reachableCommits(root);

  return {
    root,
    beforeCommits,
    ignoredWorktree,
    ignoredWorktreeFiles,
    ignoredWorktreeHead,
    missingDirWorktree,
    detachedMergedWorktree,
    detachedMergedHead,
    detachedUnmergedWorktree,
    detachedUnmergedHead,
    mergedAncestryBranch,
    mergedAncestryTip,
    mergedSquashBranch,
    mergedRebaseBranch,
    unmergedBranch,
    unmergedTip
  };
}

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

describe.each(seeds)("tidy conservation — generated repository, seed %i", (seed) => {
  it("conserves every commit and every worktree byte across --apply, undo, and a no-op second --apply", () => {
    const scenario = buildScenario(seed);
    const { root } = scenario;

    // Injected race: crash one worktree quarantine deliberately, right
    // after its tree half has moved but before its admin half or manifest
    // entry -- the exact window a real crash would land in, on whichever of
    // the two equivalent-risk worktrees this seed picks.
    const raceTarget = seed % 2 === 0 ? scenario.detachedMergedWorktree : scenario.ignoredWorktree;
    const raceHead = run(raceTarget, ["rev-parse", "HEAD"]).trim();
    const raceBranch = raceTarget === scenario.ignoredWorktree ? "claude/merged-worktree" : null;
    const raceRun = createTidyRunId(new Date());
    expect(() =>
      quarantineWorktree(root, { path: raceTarget, branch: raceBranch, head: raceHead }, raceRun, {
        afterTreeMove: () => {
          throw new Error("injected race: simulated crash mid-quarantine");
        }
      })
    ).toThrow();

    // First --apply: recovers the injected race, then retires everything
    // else this scenario made retirable.
    const first = data(runTidyCommand({ repo: root, apply: true }));
    expect(first.journalRecovery.rolledForward.length).toBeGreaterThan(0);
    const run1 = first.run;
    expect(run1).not.toBeNull();

    // Conservation, part one: every commit reachable before is reachable now.
    const afterFirstApply = reachableCommits(root);
    for (const commit of scenario.beforeCommits) {
      expect(afterFirstApply.has(commit), `commit ${commit} lost after first --apply`).toBe(true);
    }

    // Conservation, part two: the gitignored file's bytes, wherever they
    // ended up. When this worktree was the injected race's own target, it is
    // already fully quarantined by the time `first` runs at all -- recovery
    // finished it before assessment even began, so it never appears in
    // `first.worktrees`. Its presence on disk is what actually says whether
    // it was retired, regardless of which of the two runs did it.
    const ignoredNowAt = existsSync(scenario.ignoredWorktree)
      ? scenario.ignoredWorktree
      : findQuarantinedWorktreeDir(root, [run1!, raceRun], scenario.ignoredWorktree);
    expect(ignoredNowAt, "the merged worktree's quarantine directory must be findable").not.toBeNull();
    expectSameFiles(scenario.ignoredWorktreeFiles, snapshotFiles(ignoredNowAt!), "gitignored file conservation");

    // The unmerged branch's own worktree-free commit is untouched and its
    // branch ref is exactly where it was.
    expect(run(root, ["rev-parse", scenario.unmergedBranch]).trim()).toBe(scenario.unmergedTip);

    // The detached-unmerged worktree was never touched at all.
    expect(existsSync(scenario.detachedUnmergedWorktree)).toBe(true);
    expect(run(scenario.detachedUnmergedWorktree, ["rev-parse", "HEAD"]).trim()).toBe(scenario.detachedUnmergedHead);

    // Second --apply is a no-op: nothing new is retired, and no new
    // branches or worktrees vanish.
    const headsBeforeSecond = run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    const worktreesBeforeSecond = run(root, ["worktree", "list", "--porcelain"]);
    const second = data(runTidyCommand({ repo: root, apply: true }));
    expect(second.worktrees.filter((w) => w.retired)).toHaveLength(0);
    expect(second.branches.filter((b) => b.retired)).toHaveLength(0);
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).toBe(headsBeforeSecond);
    expect(run(root, ["worktree", "list", "--porcelain"])).toBe(worktreesBeforeSecond);
    // The second run's own journal, if it wrote one at all, has nothing to
    // recover and nothing left dangling.
    expect(second.journalRecovery.rolledForward).toEqual([]);
    expect(second.journalRecovery.rolledBack).toEqual([]);

    // Undo every run this scenario used -- the injected race's own run and
    // the main apply -- and require the exact prior state back: same
    // commits reachable, same worktree bytes, same branch tips.
    for (const runId of [raceRun, run1!]) {
      if (readTidyRun(root, runId)) runTidyUndoCommand({ repo: root, run: runId });
    }

    expect(reachableCommits(root)).toEqual(scenario.beforeCommits);
    expect(run(root, ["rev-parse", scenario.mergedAncestryBranch]).trim()).toBe(scenario.mergedAncestryTip);
    expect(existsSync(scenario.ignoredWorktree)).toBe(true);
    expectSameFiles(scenario.ignoredWorktreeFiles, snapshotFiles(scenario.ignoredWorktree), "undo: gitignored file restored exactly");
    expect(run(scenario.ignoredWorktree, ["rev-parse", "HEAD"]).trim()).toBe(scenario.ignoredWorktreeHead);
    expect(existsSync(scenario.detachedMergedWorktree)).toBe(true);
    expect(run(scenario.detachedMergedWorktree, ["rev-parse", "HEAD"]).trim()).toBe(scenario.detachedMergedHead);
  });
});

/** Find where a quarantined worktree's files actually ended up, across whichever of the given runs quarantined it. */
function findQuarantinedWorktreeDir(root: string, runIds: string[], originalPath: string): string | null {
  for (const runId of runIds) {
    const manifest = readTidyRun(root, runId);
    const entry = manifest?.worktrees.find((w) => w.worktreePath === originalPath);
    if (entry) return path.join(entry.quarantineDir, "worktree");
  }
  return null;
}

describe("tidy conservation — reused names", () => {
  it("a branch name reused after quarantine is never confused with the quarantined original, and undo refuses to clobber it", () => {
    const scenario = buildScenario(101);
    const { root } = scenario;

    const applied = data(runTidyCommand({ repo: root, apply: true }));
    const run1 = applied.run!;
    expect(applied.branches.find((b) => b.branch === scenario.mergedAncestryBranch)?.retired).toBe(true);
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).not.toContain(scenario.mergedAncestryBranch);

    // A brand-new branch reuses the exact same name, with content that was
    // never on main -- exactly what a second, unrelated agent picking the
    // same task-branch convention would produce.
    run(root, ["checkout", "-q", "-b", scenario.mergedAncestryBranch]);
    writeFileSync(path.join(root, "reused.txt"), "reused content\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "reused branch, unrelated content"]);
    run(root, ["checkout", "-q", "main"]);
    const reusedTip = run(root, ["rev-parse", scenario.mergedAncestryBranch]).trim();
    expect(reusedTip).not.toBe(scenario.mergedAncestryTip);

    // tidy must classify the reused name on its own current content, not
    // remember it as already-quarantined.
    const preview = data(runTidyCommand({ repo: root }));
    const reusedEntry = preview.branches.find((b) => b.branch === scenario.mergedAncestryBranch);
    expect(reusedEntry?.verdict).toBe("unmerged");

    // Undo of the original run must refuse to restore over the occupied
    // name, and must not touch the reused branch's own content.
    const undone = runTidyUndoCommand({ repo: root, run: run1 });
    expect(undone.data.branchesFailed).toContain(scenario.mergedAncestryBranch);
    expect(run(root, ["rev-parse", scenario.mergedAncestryBranch]).trim()).toBe(reusedTip);

    // No data lost either way: the reused branch is intact, and the original
    // quarantined commit is still reachable through its own quarantine ref
    // (the refused restore leaves it exactly where it was).
    expect(run(root, ["rev-parse", `refs/arcadia/tidy/${run1}/heads/${scenario.mergedAncestryBranch}`]).trim()).toBe(
      scenario.mergedAncestryTip
    );
  });
});
