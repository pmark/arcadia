import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateMerge, runTidyCommand, type TidyCommandData } from "../src/commands/tidy.js";
import { parseGithubSlug, summarizeClutter } from "../src/git/worktrees.js";
import type { CommandSuccess } from "../src/cli/response.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.ARCADIA_INVOKED_FROM;
});

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Non-throwing ancestry check, for asserting a precondition rather than acting on it. */
function isAncestorOf(cwd: string, ancestor: string, descendant: string): boolean {
  return spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd }).status === 0;
}

/** A real repository on `main` with one commit. Nothing here is mocked. */
function repo(): string {
  // realpathSync, not path.resolve: macOS resolves /tmp to /private/tmp, and
  // production's parseWorktrees realpaths every worktree it reports. Without
  // this, every path comparison in these tests silently fails to match.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-tidy-")));
  temporary.push(root);
  run(root, ["init", "--initial-branch=main", "--quiet"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "Test"]);
  writeFileSync(path.join(root, "README.md"), "# base\n", "utf8");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-q", "-m", "base"]);
  return root;
}

/** Advance the base branch, so a later cherry-pick lands on a different parent. */
function commitOnMain(root: string, file: string): void {
  run(root, ["checkout", "-q", "main"]);
  writeFileSync(path.join(root, file), `${file}\n`, "utf8");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-q", "-m", file]);
}

function commitOn(root: string, branch: string, file: string): void {
  run(root, ["checkout", "-q", "-b", branch]);
  writeFileSync(path.join(root, file), `${file}\n`, "utf8");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-q", "-m", file]);
  run(root, ["checkout", "-q", "main"]);
}

function worktreeOn(root: string, branch: string, name: string): string {
  const target = path.join(root, "..", `${path.basename(root)}-${name}`);
  run(root, ["worktree", "add", "-q", target, branch]);
  temporary.push(target);
  return realpathSync(target);
}

function data(result: CommandSuccess<TidyCommandData>): TidyCommandData {
  return result.data;
}

describe("arcadia tidy — safety invariants", () => {
  it("changes nothing without --apply, however retirable the state is", () => {
    const root = repo();
    commitOn(root, "claude/finished", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/finished"]);

    const before = run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    const result = data(runTidyCommand({ repo: root }));

    expect(result.applied).toBe(false);
    expect(result.branches.find((b) => b.branch === "claude/finished")?.verdict).toBe("merged");
    // The ref is still there.
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).toBe(before);
  });

  it("never deletes a branch carrying commits the base branch does not have", () => {
    const root = repo();
    commitOn(root, "claude/unmerged", "a.txt");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.branches.find((b) => b.branch === "claude/unmerged");

    expect(entry?.verdict).toBe("unmerged");
    expect(entry?.ahead).toBe(1);
    expect(entry?.retired).toBe(false);
    // Still present after an --apply run.
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).toContain("claude/unmerged");
  });

  it("retires an agent branch once every commit is on the base branch", () => {
    const root = repo();
    commitOn(root, "claude/done", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/done"]);

    const result = data(runTidyCommand({ repo: root, apply: true }));

    expect(result.branches.find((b) => b.branch === "claude/done")?.retired).toBe(true);
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).not.toContain("claude/done");
  });

  it("leaves a merged branch alone when the operator named it, until asked", () => {
    const root = repo();
    commitOn(root, "my-own-work", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "my-own-work"]);

    const guarded = data(runTidyCommand({ repo: root, apply: true }));
    expect(guarded.branches.find((b) => b.branch === "my-own-work")?.verdict).toBe("protected");
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).toContain("my-own-work");

    const opted = data(runTidyCommand({ repo: root, apply: true, includeOwnBranches: true }));
    expect(opted.branches.find((b) => b.branch === "my-own-work")?.retired).toBe(true);
  });

  it("never touches a worktree with uncommitted changes, even on a merged branch", () => {
    const root = repo();
    commitOn(root, "claude/dirty", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/dirty"]);
    const tree = worktreeOn(root, "claude/dirty", "dirty");
    writeFileSync(path.join(tree, "scratch.txt"), "in progress\n", "utf8");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((w) => w.path === tree);

    expect(entry?.verdict).toBe("dirty");
    expect(entry?.retired).toBe(false);
    expect(result.needsAttention.join("\n")).toContain(tree);
    // The whole point: the file survives an --apply run.
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("retires a clean worktree whose branch is merged, and its branch with it", () => {
    const root = repo();
    commitOn(root, "claude/spent", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/spent"]);
    const tree = worktreeOn(root, "claude/spent", "spent");

    const result = data(runTidyCommand({ repo: root, apply: true }));

    expect(result.worktrees.find((w) => w.path === tree)?.retired).toBe(true);
    expect(run(root, ["worktree", "list"])).not.toContain(tree);
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).not.toContain("claude/spent");
  });

  it("keeps a clean worktree whose branch still holds unmerged work", () => {
    const root = repo();
    commitOn(root, "claude/live", "a.txt");
    const tree = worktreeOn(root, "claude/live", "live");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((w) => w.path === tree);

    expect(entry?.verdict).toBe("unmerged");
    expect(entry?.ahead).toBe(1);
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("protects the primary worktree and the base branch", () => {
    const root = repo();

    const result = data(runTidyCommand({ repo: root, apply: true }));

    expect(result.worktrees[0].verdict).toBe("protected");
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).toContain("main");
  });

  it("protects the worktree the operator is standing in", () => {
    const root = repo();
    commitOn(root, "claude/here", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/here"]);
    const tree = worktreeOn(root, "claude/here", "here");
    process.env.ARCADIA_INVOKED_FROM = tree;

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((w) => w.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("standing in");
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("flags unmerged work with no remote copy as the only copy", () => {
    const root = repo();
    commitOn(root, "claude/only-copy", "a.txt");

    const result = data(runTidyCommand({ repo: root }));

    expect(result.needsAttention.join("\n")).toContain("only copy");
    expect(result.needsAttention.join("\n")).toContain("claude/only-copy");
  });

  it("reports where the live work is, not just what is disposable", () => {
    const root = repo();
    commitOn(root, "claude/active", "a.txt");
    const tree = worktreeOn(root, "claude/active", "active");

    const result = data(runTidyCommand({ repo: root }));

    expect(result.worktrees.find((w) => w.path === tree)?.verdict).toBe("unmerged");
    expect(result.baseBranch).toBe("main");
  });
});

/** A bare repository standing in for `origin`, so `git fetch` has something real to reach. */
function bareOrigin(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-tidy-origin-")));
  temporary.push(root);
  run(root, ["init", "--bare", "--initial-branch=main", "--quiet"]);
  return root;
}

function cloneOf(origin: string, name: string): string {
  const target = path.join(origin, "..", name);
  execFileSync("git", ["clone", "--quiet", origin, target], { encoding: "utf8" });
  const resolved = realpathSync(target);
  temporary.push(resolved);
  return resolved;
}

describe("arcadia tidy — fetching before comparing", () => {
  // Reproduces the actual bug found operating this repository: every worktree
  // shares one set of refs, so a `main` nobody has pulled in recently makes
  // ancestry checks lie by omission. A branch that is genuinely merged reads
  // as unmerged, which looks cautious but is reporting stale information as
  // current.
  it("finds a merge that only exists on origin, once fetched", () => {
    const origin = bareOrigin();
    const publisher = cloneOf(origin, "publisher");
    run(publisher, ["config", "user.email", "test@example.com"]);
    run(publisher, ["config", "user.name", "Test"]);
    writeFileSync(path.join(publisher, "README.md"), "# base\n", "utf8");
    run(publisher, ["add", "-A"]);
    run(publisher, ["commit", "-q", "-m", "base"]);
    run(publisher, ["push", "-q", "origin", "main"]);

    // The operator's clone, made before the branch below is merged and
    // pushed -- exactly like a worktree nobody has run `git pull` in since.
    const stale = cloneOf(origin, "stale");
    run(stale, ["config", "user.email", "test@example.com"]);
    run(stale, ["config", "user.name", "Test"]);
    commitOn(stale, "claude/finished", "feature.txt");
    run(stale, ["push", "-q", "origin", "claude/finished"]);

    // Someone else -- another session, another machine -- merges and pushes.
    run(publisher, ["fetch", "-q", "origin", "claude/finished"]);
    run(publisher, ["merge", "-q", "--no-ff", "-m", "merge", "origin/claude/finished"]);
    run(publisher, ["push", "-q", "origin", "main"]);

    // Without fetching, the stale clone's own local `main` has no idea.
    const withoutFetch = data(runTidyCommand({ repo: stale, noFetch: true }));
    expect(withoutFetch.fetched).toBe(false);
    expect(withoutFetch.branches.find((b) => b.branch === "claude/finished")?.verdict).toBe("unmerged");

    // Fetching first is the default, and it changes the answer to the true one.
    const withFetch = data(runTidyCommand({ repo: stale }));
    expect(withFetch.fetched).toBe(true);
    expect(withFetch.comparisonRef).toBe("origin/main");
    const entry = withFetch.branches.find((b) => b.branch === "claude/finished");
    expect(entry?.verdict).toBe("merged");
    expect(entry?.mergeProof).toBe("ancestry");
  });

  it("falls back to the local branch, and says so, when there is no origin", () => {
    const root = repo();

    const result = data(runTidyCommand({ repo: root }));

    expect(result.fetched).toBe(false);
    expect(result.fetchNote).toContain("No `origin` remote");
    expect(result.comparisonRef).toBe("main");
  });
});

describe("evaluateMerge — squash and rebase merges", () => {
  // This is the part worth testing directly: a squash or rebase merge rewrites
  // history, so the branch's own commits are never ancestors of the base
  // branch after merging -- only the commit GitHub actually produced is. The
  // whole point of checking `mergeCommit` ancestry instead of the branch tip
  // is proving content landed even though the branch itself looks unmerged.
  it("finds a squash merge that patch equivalence cannot see, via its verified merge commit", () => {
    const root = repo();
    // Two commits on the branch, collapsed into one on main -- the real shape
    // of a GitHub squash merge. Neither original patch matches the combined
    // one, so `git cherry` cannot clear this and the pull-request check is the
    // only thing that can.
    run(root, ["checkout", "-q", "-b", "claude/squashed"]);
    writeFileSync(path.join(root, "a.txt"), "a.txt\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "add a"]);
    writeFileSync(path.join(root, "b.txt"), "b.txt\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "add b"]);

    run(root, ["checkout", "-q", "main"]);
    writeFileSync(path.join(root, "a.txt"), "a.txt\n", "utf8");
    writeFileSync(path.join(root, "b.txt"), "b.txt\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "squashed a and b"]);
    const squashCommit = run(root, ["rev-parse", "main"]).trim();

    const withoutProof = evaluateMerge({
      cwd: root,
      branch: "claude/squashed",
      compareRef: "main",
      prMergeCommits: new Map()
    });
    expect(withoutProof.merged).toBe(false);

    const withProof = evaluateMerge({
      cwd: root,
      branch: "claude/squashed",
      compareRef: "main",
      prMergeCommits: new Map([["claude/squashed", { sha: squashCommit, number: 42 }]])
    });
    expect(withProof.merged).toBe(true);
    if (withProof.merged) {
      expect(withProof.proof).toBe("pull-request");
      expect(withProof.reason).toContain("PR #42");
    }
  });

  it("does not trust a PR record whose claimed merge commit is not actually on the base branch", () => {
    const root = repo();
    commitOn(root, "claude/unrelated", "a.txt");

    // A fabricated or stale record naming a commit that never landed. Ancestry
    // is still checked, not merely GitHub's say-so.
    const result = evaluateMerge({
      cwd: root,
      branch: "claude/unrelated",
      compareRef: "main",
      prMergeCommits: new Map([["claude/unrelated", { sha: "0".repeat(40), number: 1 }]])
    });

    expect(result.merged).toBe(false);
  });
});

describe("evaluateMerge — patch equivalence, without GitHub", () => {
  // The offline half of merge detection. A cherry-picked or rebased commit is
  // never an ancestor of the base branch, but its content is unquestionably
  // there. Before this, such a branch was reported as unmerged work the
  // operator had to review by hand -- which is exactly the false alarm that
  // made the whole report untrustworthy.
  it("clears a cherry-picked branch with no GitHub data at all", () => {
    const root = repo();
    commitOn(root, "claude/picked", "a.txt");
    const picked = run(root, ["rev-parse", "claude/picked"]).trim();

    // Advance main first. Without this the cherry-pick reproduces the original
    // commit byte for byte -- same tree, same parent, same message, same
    // second -- and git hands back the identical SHA, making the branch a
    // literal ancestor and testing nothing.
    commitOnMain(root, "unrelated.txt");
    run(root, ["cherry-pick", picked]);

    // Precondition worth asserting: cherry-picking rewrites the commit, so
    // plain ancestry genuinely does not see it. Without this the test could
    // pass for the wrong reason.
    expect(isAncestorOf(root, "claude/picked", "main")).toBe(false);

    const result = evaluateMerge({
      cwd: root,
      branch: "claude/picked",
      compareRef: "main",
      prMergeCommits: new Map()
    });

    expect(result.merged).toBe(true);
    if (result.merged) expect(result.proof).toBe("patch-equivalent");
  });

  it("still reports a genuinely divergent branch as unmerged", () => {
    const root = repo();
    commitOn(root, "claude/real-work", "unique.txt");

    const result = evaluateMerge({
      cwd: root,
      branch: "claude/real-work",
      compareRef: "main",
      prMergeCommits: new Map()
    });

    expect(result.merged).toBe(false);
    if (!result.merged) expect(result.ahead).toBe(1);
  });

  it("prefers plain ancestry when it applies, so the cheapest proof wins", () => {
    const root = repo();
    commitOn(root, "claude/ff", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/ff"]);

    const result = evaluateMerge({
      cwd: root,
      branch: "claude/ff",
      compareRef: "main",
      prMergeCommits: new Map()
    });

    expect(result.merged).toBe(true);
    if (result.merged) expect(result.proof).toBe("ancestry");
  });
});

describe("summarizeClutter — the session-boundary nudge", () => {
  it("reports nothing to do for a clean repository", () => {
    const root = repo();

    const summary = summarizeClutter(root, "main");

    expect(summary).not.toBeNull();
    expect(summary?.extraWorktrees).toBe(0);
    expect(summary?.obviouslyMerged).toBe(0);
    expect(summary?.branches).toBe(1);
  });

  it("counts extra worktrees and already-merged branches", () => {
    const root = repo();
    commitOn(root, "claude/done", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/done"]);
    worktreeOn(root, "claude/done", "spare");

    const summary = summarizeClutter(root, "main");

    expect(summary?.extraWorktrees).toBe(1);
    expect(summary?.obviouslyMerged).toBe(1);
  });

  it("does not count unmerged work as clutter", () => {
    const root = repo();
    commitOn(root, "claude/live", "a.txt");

    const summary = summarizeClutter(root, "main");

    expect(summary?.obviouslyMerged).toBe(0);
    expect(summary?.branches).toBe(2);
  });
});

describe("parseGithubSlug", () => {
  it("extracts owner/repo from the URL forms git actually produces", () => {
    expect(parseGithubSlug("https://github.com/pmark/arcadia.git")).toBe("pmark/arcadia");
    expect(parseGithubSlug("https://github.com/pmark/arcadia")).toBe("pmark/arcadia");
    expect(parseGithubSlug("git@github.com:pmark/arcadia.git")).toBe("pmark/arcadia");
    expect(parseGithubSlug("git@github.com:pmark/arcadia")).toBe("pmark/arcadia");
  });

  it("returns null for a remote that is not GitHub", () => {
    expect(parseGithubSlug("https://gitlab.com/pmark/arcadia.git")).toBeNull();
    expect(parseGithubSlug("/Users/pmark/bare-repos/arcadia.git")).toBeNull();
  });
});
