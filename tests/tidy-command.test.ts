import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTidyCommand, type TidyCommandData } from "../src/commands/tidy.js";
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
