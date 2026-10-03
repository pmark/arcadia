import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateMerge,
  getWorktreeProtection,
  runTidyCommand,
  runTidyListCommand,
  runTidyUndoCommand,
  type TidyCommandData
} from "../src/commands/tidy.js";
import { quarantineBranch } from "../src/git/quarantine.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { reserveAgentWorktree } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { isInside, mergedPullRequests, parseGithubSlug, summarizeClutter } from "../src/git/worktrees.js";
import type { CommandSuccess } from "../src/cli/response.js";

const temporary: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.ARCADIA_INVOKED_FROM;
  delete process.env.ARCADIA_WORKSPACE;
  process.env.PATH = originalPath;
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
  const workspace = workspaceFor(root);
  temporary.push(workspace);
  initWorkspace(workspace);
  process.env.ARCADIA_WORKSPACE = workspace;
  return root;
}

function workspaceFor(root: string): string {
  return path.join(path.dirname(root), `${path.basename(root)}-workspace`);
}

function recordLiveSession(root: string, worktree: string, branch: string, status: "prepared" | "running" = "prepared"): void {
  withDatabase(workspaceFor(root), (db) => {
    db.pragma("foreign_keys = OFF");
    const timestamp = "2026-09-06T12:00:00.000Z";
    db.prepare(`INSERT INTO agent_sessions (
      id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id,
      work_item_id, packet_id, packet_path, packet_sha256, authorizing_decisions_json,
      execution_profile_json, provider_profile, provider, model, effort,
      provider_mapping_id, provider_binding_id, base_revision, branch, worktree_path,
      provider_session_id, display_name, terminal_transport, tmux_session_name, status,
      prepared_at, started_at, ended_at, exit_status, created_at, updated_at
    ) VALUES (
      @id, 'project-test', 'test', @repositoryPath, 'docs/plans/test.md', 'test', 'test-action',
      'work-test', 'packet-test', 'prompt.md', 'sha', '[]', NULL, 'test', 'claude-code-cli',
      'sonnet', 'high', NULL, NULL, @base, @branch, @worktree, @providerSession,
      'Test session', 'tmux', @tmux, @status, @timestamp, NULL, NULL, NULL, @timestamp, @timestamp
    )`).run({
      id: `session-${branch.replaceAll("/", "-")}`,
      repositoryPath: root,
      base: run(root, ["rev-parse", "main"]).trim(),
      branch,
      worktree,
      providerSession: `provider-${branch.replaceAll("/", "-")}`,
      tmux: `tmux-${branch.replaceAll("/", "-")}`,
      status,
      timestamp
    });
  });
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

/** Record a `go` handoff reservation as production writes one. */
function reserveHandoff(root: string, worktree: string, branch: string): void {
  withDatabase(workspaceFor(root), (db) => {
    reserveAgentWorktree(db, { repositoryPath: root, worktreePath: worktree, branch, now: new Date() });
  });
}

/**
 * A worktree on a branch created by the same `git worktree add -b` production
 * uses, so the branch reflog holds exactly the one creation entry a real
 * unlaunched handoff has.
 */
function handoffWorktree(root: string, branch: string, name: string): string {
  const target = path.join(root, "..", `${path.basename(root)}-${name}`);
  run(root, ["worktree", "add", "-q", "-b", branch, target, "main"]);
  temporary.push(target);
  return realpathSync(target);
}

function reservationCount(root: string, worktree: string): number {
  return withReadOnlyDatabase(workspaceFor(root), (db) => {
    const row = db.prepare(
      "SELECT COUNT(*) AS total FROM agent_worktree_reservations WHERE worktree_path = ?"
    ).get(worktree) as { total: number };
    return row.total;
  });
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

  it("retires a merged branch the operator named by default, unless excluded", () => {
    const root = repo();
    commitOn(root, "my-own-work", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "my-own-work"]);

    const guarded = data(runTidyCommand({ repo: root, apply: false }));
    expect(guarded.branches.find((b) => b.branch === "my-own-work")?.verdict).toBe("merged");

    const byDefault = data(runTidyCommand({ repo: root, apply: true }));
    expect(byDefault.branches.find((b) => b.branch === "my-own-work")?.retired).toBe(true);
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).not.toContain("my-own-work");
  });

  it("leaves an operator-named merged branch alone when --exclude-own-branches is set", () => {
    const root = repo();
    commitOn(root, "my-own-work", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "my-own-work"]);

    const opted = data(runTidyCommand({ repo: root, apply: true, excludeOwnBranches: true }));
    expect(opted.branches.find((b) => b.branch === "my-own-work")?.verdict).toBe("protected");
    expect(run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).toContain("my-own-work");
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

  it("protects a clean zero-commit worktree with a prepared Session lease", () => {
    const root = repo();
    run(root, ["branch", "claude/planning"]);
    const tree = worktreeOn(root, "claude/planning", "planning");
    recordLiveSession(root, tree, "claude/planning");

    const result = data(runTidyCommand({ repo: root, workspace: workspaceFor(root), apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("live prepared Session lease");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("finds the primary-repository lease when tidy is invoked through a linked worktree", () => {
    const root = repo();
    const branch = "claude/invoked-through-linked-tree";
    run(root, ["branch", branch]);
    const tree = worktreeOn(root, branch, "invoked-through-linked-tree");
    recordLiveSession(root, tree, branch);

    const result = data(runTidyCommand({ repo: tree, workspace: workspaceFor(root), apply: true, noFetch: true, noGithub: true }));

    expect(result.worktrees.find((candidate) => candidate.path === tree)?.verdict).toBe("protected");
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("rechecks the Session lease under the apply interlock before retiring", () => {
    const root = repo();
    const branch = "claude/racing-session";
    run(root, ["branch", branch]);
    const tree = worktreeOn(root, branch, "racing-session");
    let injected = false;

    const result = data(runTidyCommand({
      repo: root,
      workspace: workspaceFor(root),
      apply: true,
      noFetch: true,
      noGithub: true,
      testHooks: {
        afterAssessment() {
          injected = true;
          recordLiveSession(root, tree, branch, "running");
        }
      }
    }));

    expect(injected).toBe(true);
    expect(result.worktrees.find((candidate) => candidate.path === tree)?.verdict).toBe("protected");
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("screens 100 reproducible stale-lease interleavings against the apply-time protection read", () => {
    const root = repo();
    const branch = "claude/lease-screen";
    run(root, ["branch", branch]);
    const tree = worktreeOn(root, branch, "lease-screen");
    recordLiveSession(root, tree, branch, "running");
    const sessionId = `session-${branch.replaceAll("/", "-")}`;

    withDatabase(workspaceFor(root), (db) => {
      const firstSeed = 0x5eed;
      for (let offset = 0; offset < 100; offset += 1) {
        const seed = firstSeed + offset;
        db.prepare("UPDATE agent_sessions SET status = 'completed' WHERE id = ?").run(sessionId);
        const stalePreviewRead = getWorktreeProtection(db, root, tree);
        db.prepare("UPDATE agent_sessions SET status = 'running' WHERE id = ?").run(sessionId);
        const applyTimeRead = getWorktreeProtection(db, root, tree);

        expect(stalePreviewRead, `seed ${seed}`).toBeNull();
        expect(applyTimeRead?.reason, `seed ${seed}`).toContain("live running Session lease");
      }
    });
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
  // Each call owns a unique parent, so an interrupted run's leftovers and
  // concurrent runs can never collide on a fixed sibling name.
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-tidy-clone-")));
  temporary.push(parent);
  const target = path.join(parent, name);
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

    const squashedTip = run(root, ["rev-parse", "claude/squashed"]).trim();
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
      prMergeCommits: new Map([["claude/squashed", { sha: squashCommit, headRefOid: squashedTip, number: 42 }]])
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
    const tip = run(root, ["rev-parse", "claude/unrelated"]).trim();

    // A fabricated or stale record naming a commit that never landed. Ancestry
    // is still checked, not merely GitHub's say-so.
    const result = evaluateMerge({
      cwd: root,
      branch: "claude/unrelated",
      compareRef: "main",
      prMergeCommits: new Map([["claude/unrelated", { sha: "0".repeat(40), headRefOid: tip, number: 1 }]])
    });

    expect(result.merged).toBe(false);
  });

  it("does not vouch for a new branch that reuses an old merged branch's name", () => {
    const root = repo();
    // The original PR: claude/reused merged (squashed) onto main, then its
    // branch was deleted, the way GitHub deletes a merged head by default.
    run(root, ["checkout", "-q", "-b", "claude/reused"]);
    writeFileSync(path.join(root, "old.txt"), "old\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "old content"]);
    const oldHeadRefOid = run(root, ["rev-parse", "claude/reused"]).trim();
    run(root, ["checkout", "-q", "main"]);
    writeFileSync(path.join(root, "old.txt"), "old\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "squashed old content"]);
    const squashCommit = run(root, ["rev-parse", "main"]).trim();
    run(root, ["branch", "-D", "claude/reused"]);

    // A brand-new, unrelated branch reuses the same name later.
    run(root, ["checkout", "-q", "-b", "claude/reused"]);
    writeFileSync(path.join(root, "new.txt"), "new\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "unrelated new work"]);
    run(root, ["checkout", "-q", "main"]);

    const result = evaluateMerge({
      cwd: root,
      branch: "claude/reused",
      compareRef: "main",
      prMergeCommits: new Map([["claude/reused", { sha: squashCommit, headRefOid: oldHeadRefOid, number: 7 }]])
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

  it("does not call a reverted upstream patch merged merely because git cherry finds its patch-id", () => {
    const root = repo();
    commitOn(root, "claude/reverted-upstream", "wanted.txt");
    const wanted = run(root, ["rev-parse", "claude/reverted-upstream"]).trim();
    commitOnMain(root, "unrelated-before-pick.txt");
    run(root, ["cherry-pick", wanted]);
    run(root, ["revert", "--no-edit", "HEAD"]);

    const result = evaluateMerge({
      cwd: root,
      branch: "claude/reverted-upstream",
      compareRef: "main",
      prMergeCommits: new Map()
    });

    expect(result.merged).toBe(false);
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

describe("arcadia tidy — quarantine ref identity and concurrent branch movement", () => {
  it("refuses 100 reproducible branch-movement interleavings at compare-and-swap quarantine", () => {
    const root = repo();
    const expected = run(root, ["commit-tree", "main^{tree}", "-p", "main", "-m", "expected race tip"]).trim();
    const advanced = run(root, ["commit-tree", "main^{tree}", "-p", expected, "-m", "advanced race tip"]).trim();
    const firstSeed = 0xcafe;
    for (let offset = 0; offset < 100; offset += 1) {
      const seed = firstSeed + offset;
      const branch = `claude/cas-${seed}`;
      run(root, ["update-ref", `refs/heads/${branch}`, expected]);
      run(root, ["update-ref", `refs/heads/${branch}`, advanced, expected]);

      expect(quarantineBranch(root, branch, `run-${seed}`, expected), `seed ${seed}`).toBeNull();
      expect(run(root, ["rev-parse", branch]).trim(), `seed ${seed}`).toBe(advanced);
      run(root, ["update-ref", "-d", `refs/heads/${branch}`, advanced]);
    }
  }, 60_000);

  it("never collides between branch names sharing slash/dash components, since the branch's own name is part of the ref path", () => {
    const root = repo();
    commitOn(root, "claude/a-b", "first.txt");
    const first = run(root, ["rev-parse", "claude/a-b"]).trim();
    commitOnMain(root, "advance-first.txt");
    run(root, ["cherry-pick", first]);
    commitOn(root, "claude/a/b", "second.txt");
    const second = run(root, ["rev-parse", "claude/a/b"]).trim();
    commitOnMain(root, "advance-second.txt");
    run(root, ["cherry-pick", second]);

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const quarantined = result.branches.filter((entry) => entry.quarantineRef).map((entry) => entry.quarantineRef!);

    expect(new Set(quarantined).size).toBe(2);
    expect(quarantined.map((ref) => run(root, ["rev-parse", ref]).trim()).sort()).toEqual([first, second].sort());
  });

  it("never collides between two generations of the same reused branch name, since each tidy run gets its own id", () => {
    const root = repo();
    const quarantineOneGeneration = (file: string) => {
      commitOn(root, "claude/reused", file);
      const branchTip = run(root, ["rev-parse", "claude/reused"]).trim();
      commitOnMain(root, `advance-${file}`);
      run(root, ["cherry-pick", branchTip]);
      const result = data(runTidyCommand({ repo: root, apply: true }));
      return { branchTip, ref: result.branches.find((entry) => entry.branch === "claude/reused")?.quarantineRef };
    };

    const first = quarantineOneGeneration("one.txt");
    const second = quarantineOneGeneration("two.txt");

    expect(first.ref).toBeTruthy();
    expect(second.ref).toBeTruthy();
    expect(first.ref).not.toBe(second.ref);
    expect(run(root, ["rev-parse", first.ref!]).trim()).toBe(first.branchTip);
    expect(run(root, ["rev-parse", second.ref!]).trim()).toBe(second.branchTip);
  });

  it("does not quarantine a branch that advances after its tip is read", () => {
    const root = repo();
    commitOn(root, "claude/moved-during-retire", "move.txt");
    const original = run(root, ["rev-parse", "claude/moved-during-retire"]).trim();
    commitOnMain(root, "advance-move.txt");
    run(root, ["cherry-pick", original]);
    let injected = false;

    const result = data(runTidyCommand({
      repo: root,
      workspace: workspaceFor(root),
      apply: true,
      testHooks: {
        beforeForcedBranchDelete(branch: string, expectedTip: string) {
          if (branch !== "claude/moved-during-retire") return;
          injected = true;
          const late = run(root, ["commit-tree", "main^{tree}", "-p", expectedTip, "-m", "late concurrent commit"]).trim();
          run(root, ["update-ref", `refs/heads/${branch}`, late, expectedTip]);
        }
      }
    }));

    expect(injected).toBe(true);
    expect(result.branches.find((entry) => entry.branch === "claude/moved-during-retire")?.retired).toBe(false);
    expect(run(root, ["show-ref", "--verify", "refs/heads/claude/moved-during-retire"])).toContain("refs/heads/claude/moved-during-retire");
  });

  it("does not delete a branch that gets checked out into a new worktree between preview and apply", () => {
    const root = repo();
    commitOn(root, "claude/checked-out-midrun", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/checked-out-midrun"]);
    let tree: string | null = null;

    const result = data(runTidyCommand({
      repo: root,
      apply: true,
      testHooks: {
        // The preview-time snapshot has no worktree for this branch at all; a
        // `go` handoff or a desktop agent checking it out here, between
        // preview and the apply transaction, is exactly what the forced
        // `update-ref -d` path (issue #740) could not see.
        afterAssessment() {
          tree = worktreeOn(root, "claude/checked-out-midrun", "checked-out-midrun");
        }
      }
    }));

    const entry = result.branches.find((candidate) => candidate.branch === "claude/checked-out-midrun");
    expect(entry?.retired).toBe(false);
    expect(entry?.verdict).toBe("protected");
    expect(run(root, ["show-ref", "--verify", "refs/heads/claude/checked-out-midrun"])).toContain("refs/heads/claude/checked-out-midrun");
    expect(tree).not.toBeNull();
    expect(run(root, ["worktree", "list"])).toContain(tree!);
    expect(run(root, ["-C", tree!, "rev-parse", "HEAD"]).trim()).toBeTruthy();
  });
});

describe("arcadia tidy — worktree liveness beyond Session leases and go handoffs", () => {
  it("protects a fresh desktop-agent worktree at the base tip that Arcadia never tracked", () => {
    const root = repo();
    // No recordLiveSession, no reserveHandoff: this worktree is invisible to
    // Arcadia's own Session/handoff tracking, exactly like a Claude Code or
    // Codex desktop session Arcadia never launched (issue #739). Its branch
    // reflog holds only the entry `git worktree add -b` itself writes.
    const tree = handoffWorktree(root, "claude/fresh-desktop", "fresh-desktop");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("has not moved");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("stops protecting an untouched worktree once the grace window has passed", () => {
    const root = repo();
    const tree = handoffWorktree(root, "claude/long-abandoned", "long-abandoned");
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const result = data(runTidyCommand({ repo: root, apply: true, now: farFuture, livenessGraceMs: 1000 }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    // Never diverged from the base branch, so retiring it loses nothing.
    expect(entry?.verdict).toBe("merged");
    expect(entry?.retired).toBe(true);
  });

  it("protects a locked worktree regardless of its merge state", () => {
    const root = repo();
    commitOn(root, "claude/locked-but-merged", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/locked-but-merged"]);
    const tree = worktreeOn(root, "claude/locked-but-merged", "locked-but-merged");
    run(root, ["worktree", "lock", tree, "--reason", "manual inspection"]);

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("locked");
    expect(entry?.retired).toBe(false);
    run(root, ["worktree", "unlock", tree]);
  });

  it("protects a locked worktree even after its directory is deleted by hand", () => {
    const root = repo();
    commitOn(root, "claude/locked-then-deleted", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/locked-then-deleted"]);
    const tree = worktreeOn(root, "claude/locked-then-deleted", "locked-then-deleted");
    run(root, ["worktree", "lock", tree, "--reason", "manual inspection"]);
    // The lock marks the registration, not the directory -- simulate someone
    // deleting the directory by hand while it stays locked.
    rmSync(tree, { recursive: true, force: true });

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("locked");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("protects a merged worktree that is another process's current directory", () => {
    const root = repo();
    commitOn(root, "claude/live-cwd", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/live-cwd"]);
    const tree = worktreeOn(root, "claude/live-cwd", "live-cwd");
    // Decouple "this process's actual OS-level cwd" (what `lsof` reports, and
    // what this test means to exercise) from "the directory `tidy` was
    // invoked from" (`ARCADIA_INVOKED_FROM`, checked earlier and independently
    // as `here` in assessWorktree) -- otherwise chdir'ing into `tree` would
    // trip the "standing in this worktree" protection instead.
    process.env.ARCADIA_INVOKED_FROM = root;
    const previousCwd = process.cwd();
    process.chdir(tree);

    let result: ReturnType<typeof data>;
    try {
      // This test process's own cwd is exactly what `lsof -d cwd` reports for
      // it, standing in for any other live process (an editor, a shell, an
      // agent) with this worktree as its working directory.
      result = data(runTidyCommand({ repo: root, apply: true }));
    } finally {
      process.chdir(previousCwd);
    }

    const entry = result.worktrees.find((candidate) => candidate.path === tree);
    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("running process");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });
});

describe("mergedPullRequests — cross-repository (fork) exclusion", () => {
  it("drops a cross-repository pull request, so its branch name cannot vouch for an unrelated local branch", () => {
    const root = repo();
    const bin = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-tidy-bin-")));
    temporary.push(bin);
    const gh = path.join(bin, "gh");
    const forkOid = "1".repeat(40);
    const ownOid = "2".repeat(40);
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        "cat <<'JSON'",
        JSON.stringify([
          { number: 1, headRefName: "patch-1", mergeCommit: { oid: forkOid }, headRefOid: forkOid, isCrossRepository: true },
          { number: 2, headRefName: "claude/own", mergeCommit: { oid: ownOid }, headRefOid: ownOid, isCrossRepository: false }
        ]),
        "JSON"
      ].join("\n"),
      "utf8"
    );
    chmodSync(gh, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    run(root, ["remote", "add", "origin", "https://github.com/example/fixture.git"]);

    const merges = mergedPullRequests(root);

    expect(merges).not.toBeNull();
    expect(merges!.map((entry) => entry.headBranch)).toEqual(["claude/own"]);
  });
});

describe("arcadia tidy — GitHub verification degradation", () => {
  it("fails closed and reports verification unavailable when gh exits nonzero", () => {
    const root = repo();
    const bin = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-tidy-bin-")));
    temporary.push(bin);
    const gh = path.join(bin, "gh");
    writeFileSync(gh, "#!/bin/sh\nexit 1\n", "utf8");
    chmodSync(gh, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    run(root, ["remote", "add", "origin", "https://github.com/example/fixture.git"]);
    commitOn(root, "claude/no-gh-proof", "only-here.txt");

    const result = data(runTidyCommand({ repo: root, noFetch: true, apply: true }));

    expect(result.githubVerificationAvailable).toBe(false);
    expect(result.branches.find((entry) => entry.branch === "claude/no-gh-proof")?.verdict).toBe("unmerged");
    expect(run(root, ["show-ref", "--verify", "refs/heads/claude/no-gh-proof"])).toContain("refs/heads/claude/no-gh-proof");
  });
});

describe("arcadia tidy — handoff reservations end with the work", () => {
  it("retires a reserved worktree whose agent committed and whose work landed", () => {
    const root = repo();
    const branch = "claude/served";
    // Reserved before the branch's own commit: the ordering `go` produces when
    // it prepares a worktree and an agent then works in it.
    commitOn(root, branch, "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", branch]);
    const tree = worktreeOn(root, branch, "served");
    reserveHandoff(root, tree, branch);

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("merged");
    expect(entry?.retired).toBe(true);
    expect(run(root, ["worktree", "list"])).not.toContain(tree);
    expect(reservationCount(root, tree)).toBe(0);
  });

  it("keeps a prepared handoff nobody has launched yet", () => {
    const root = repo();
    const branch = "claude/unlaunched";
    // No commit of its own: the branch still sits exactly where `go` created
    // it, which is clean and merged and must survive anyway.
    const tree = handoffWorktree(root, branch, "unlaunched");
    reserveHandoff(root, tree, branch);

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("go handoff reservation");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
    expect(reservationCount(root, tree)).toBe(1);
  });

  it("keeps a reserved worktree whose agent left uncommitted changes", () => {
    const root = repo();
    const branch = "claude/mid-flight";
    commitOn(root, branch, "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", branch]);
    const tree = worktreeOn(root, branch, "mid-flight");
    reserveHandoff(root, tree, branch);
    writeFileSync(path.join(tree, "wip.txt"), "in flight\n", "utf8");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("keeps a reserved worktree whose branch has not landed", () => {
    const root = repo();
    const branch = "claude/unlanded";
    commitOn(root, branch, "a.txt");
    const tree = worktreeOn(root, branch, "unlanded");
    reserveHandoff(root, tree, branch);

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("lets a live Session lease outrank a served handoff", () => {
    const root = repo();
    const branch = "claude/leased";
    commitOn(root, branch, "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", branch]);
    const tree = worktreeOn(root, branch, "leased");
    reserveHandoff(root, tree, branch);
    recordLiveSession(root, tree, branch, "running");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);

    expect(entry?.verdict).toBe("protected");
    expect(entry?.reason).toContain("Session lease");
    expect(entry?.retired).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });
});

describe("arcadia tidy — quarantine survives what deletion used to lose", () => {
  it("carries a gitignored file through worktree quarantine and back out again on undo", () => {
    const root = repo();
    writeFileSync(path.join(root, ".gitignore"), "*.ignored\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "ignore rule"]);
    commitOn(root, "claude/gitignore-survives", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/gitignore-survives"]);
    const tree = worktreeOn(root, "claude/gitignore-survives", "gitignore-survives");
    writeFileSync(path.join(tree, "keepme.ignored"), "untracked, ignored, and must survive\n", "utf8");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);
    expect(entry?.retired).toBe(true);
    expect(existsSync(path.join(tree, "keepme.ignored"))).toBe(false);
    expect(run(root, ["worktree", "list"])).not.toContain(tree);

    const undo = data2(runTidyUndoCommand({ repo: root, run: result.run! }));
    expect(undo.worktreesRestored).toEqual([tree]);
    expect(existsSync(path.join(tree, "keepme.ignored"))).toBe(true);
    expect(readFileSync(path.join(tree, "keepme.ignored"), "utf8")).toBe("untracked, ignored, and must survive\n");
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("pins and quarantines a missing worktree's admin directory instead of pruning it, keeping an otherwise-unreachable commit alive", () => {
    const root = repo();
    const target = path.join(root, "..", `${path.basename(root)}-detached-missing`);
    run(root, ["worktree", "add", "-q", "--detach", target, "main"]);
    temporary.push(target);
    const tree = realpathSync(target);
    const unreachable = run(tree, ["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "unreachable commit"]).trim();
    run(tree, ["reset", "-q", "--hard", unreachable]);
    rmSync(tree, { recursive: true, force: true });

    const before = data(runTidyCommand({ repo: root }));
    expect(before.worktrees.find((candidate) => candidate.path === tree)?.verdict).toBe("missing");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const entry = result.worktrees.find((candidate) => candidate.path === tree);
    expect(entry?.retired).toBe(true);
    expect(run(root, ["cat-file", "-t", unreachable]).trim()).toBe("commit");
    expect(run(root, ["for-each-ref", "--format=%(refname)"])).toContain(`refs/arcadia/tidy/${result.run}/worktrees/`);

    const undo = data2(runTidyUndoCommand({ repo: root, run: result.run! }));
    expect(undo.worktreesRestored).toEqual([tree]);
    // Undo restores exactly the prior state -- which already had no live
    // directory here, only a registered-but-missing worktree. Resurrecting a
    // directory that never existed at quarantine time would not be "exact."
    expect(existsSync(tree)).toBe(false);
    expect(run(root, ["worktree", "list"])).toContain(tree);
  });

  it("preserves a branch's reflog history under its quarantine ref, and restores it verbatim on undo", () => {
    const root = repo();
    commitOn(root, "claude/reflog-check", "a.txt");
    run(root, ["checkout", "-q", "claude/reflog-check"]);
    writeFileSync(path.join(root, "b.txt"), "second\n", "utf8");
    run(root, ["add", "-A"]);
    run(root, ["commit", "-q", "-m", "second commit"]);
    run(root, ["checkout", "-q", "main"]);
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/reflog-check"]);
    const before = run(root, ["reflog", "show", "--format=%gs", "claude/reflog-check"]);
    expect(before.trim().split("\n").length).toBeGreaterThanOrEqual(2);

    const result = data(runTidyCommand({ repo: root, apply: true }));
    const quarantineRef = result.branches.find((entry) => entry.branch === "claude/reflog-check")?.quarantineRef;
    expect(quarantineRef).toBeTruthy();
    const quarantined = run(root, ["reflog", "show", "--format=%gs", quarantineRef!]);
    for (const line of before.trim().split("\n")) {
      expect(quarantined).toContain(line);
    }

    const undo = data2(runTidyUndoCommand({ repo: root, run: result.run! }));
    expect(undo.branchesRestored).toEqual(["claude/reflog-check"]);
    const restored = run(root, ["reflog", "show", "--format=%gs", "claude/reflog-check"]);
    for (const line of before.trim().split("\n")) {
      expect(restored).toContain(line);
    }
  });

  it("restores the exact prior worktree list, refs, and file trees for a run mixing branches and worktrees", () => {
    const root = repo();
    commitOn(root, "claude/standalone", "solo.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge solo", "claude/standalone"]);
    commitOn(root, "claude/with-tree", "tree.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge tree", "claude/with-tree"]);
    const tree = worktreeOn(root, "claude/with-tree", "with-tree");

    const beforeWorktrees = run(root, ["worktree", "list"]);
    const beforeBranches = run(root, ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"]);
    const beforeFile = readFileSync(path.join(tree, "tree.txt"), "utf8");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    expect(result.branches.find((entry) => entry.branch === "claude/standalone")?.retired).toBe(true);
    expect(result.worktrees.find((entry) => entry.path === tree)?.retired).toBe(true);

    const listed = data3(runTidyListCommand({ repo: root }));
    expect(listed.runs.map((manifest) => manifest.run)).toContain(result.run);

    const undo = data2(runTidyUndoCommand({ repo: root, run: result.run! }));
    expect(undo.branchesFailed).toEqual([]);
    expect(undo.worktreesFailed).toEqual([]);

    expect(run(root, ["worktree", "list"])).toBe(beforeWorktrees);
    expect(run(root, ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"])).toBe(beforeBranches);
    expect(readFileSync(path.join(tree, "tree.txt"), "utf8")).toBe(beforeFile);

    const afterUndo = data3(runTidyListCommand({ repo: root }));
    expect(afterUndo.runs.map((manifest) => manifest.run)).not.toContain(result.run);
  });
});

function data2(result: CommandSuccess<import("../src/commands/tidy.js").TidyUndoCommandData>) {
  return result.data;
}

function data3(result: CommandSuccess<import("../src/commands/tidy.js").TidyListCommandData>) {
  return result.data;
}

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

  it("leaves protected worktrees and their branches out of both counts", () => {
    const root = repo();
    commitOn(root, "claude/done", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/done"]);
    const tree = worktreeOn(root, "claude/done", "spare");

    expect(summarizeClutter(root, "main")).toMatchObject({ extraWorktrees: 1, obviouslyMerged: 1 });
    // The same state, once tidy would decline to retire it: a nudge pointing at
    // a remedy that will correctly refuse is the noise this exemption removes.
    expect(summarizeClutter(root, "main", [tree])).toMatchObject({ extraWorktrees: 0, obviouslyMerged: 0 });
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
    expect(parseGithubSlug("/Users/operator/bare-repos/arcadia.git")).toBeNull();
  });
});

describe("isInside", () => {
  it("accepts a real child directory whose own name happens to start with two dots", () => {
    // `path.relative` returns the literal child name here, "..cache" -- a
    // naive `startsWith("..")` check on that string reads it as an
    // up-traversal and wrongly excludes a path that is genuinely inside.
    expect(isInside("/repo/worktree/..cache", "/repo/worktree")).toBe(true);
  });

  it("still rejects an actual parent or sibling path", () => {
    expect(isInside("/repo/worktree/..", "/repo/worktree")).toBe(false);
    expect(isInside("/repo/other-worktree", "/repo/worktree")).toBe(false);
  });

  it("accepts the same path and a nested descendant", () => {
    expect(isInside("/repo/worktree", "/repo/worktree")).toBe(true);
    expect(isInside("/repo/worktree/a/b", "/repo/worktree")).toBe(true);
  });
});
