import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTidyCommand, runTidyUndoCommand, type TidyCommandData } from "../src/commands/tidy.js";
import {
  createTidyRunId,
  gitCommonDir,
  quarantineBranch,
  quarantineWorktree,
  readTidyRun,
  recoverTidyJournals
} from "../src/git/quarantine.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import type { CommandSuccess } from "../src/cli/response.js";

/**
 * A crashed `tidy --apply` is not a special mode this test suite has to
 * simulate through a whole apply run: `quarantineBranch`/`quarantineWorktree`
 * are the exact functions `runTidyCommand` calls, and their `testHooks` throw
 * at the same points a real crash would land -- after the fsynced journal
 * `begin` line but before the step (or the manifest write after it) finishes.
 * Catching that thrown error here, then calling `recoverTidyJournals`
 * separately, is indistinguishable from a killed process followed by the next
 * `tidy` invocation.
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

function repo(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-tidy-journal-")));
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

function heads(root: string): string {
  return run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
}

function data(result: CommandSuccess<TidyCommandData>): TidyCommandData {
  return result.data;
}

describe("tidy journal — branch quarantine crash recovery", () => {
  it("rolls back (is a true no-op) when the crash lands before the ref transaction ever ran", () => {
    const root = repo();
    commitOn(root, "claude/merged", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/merged"]);
    const tip = run(root, ["rev-parse", "claude/merged"]).trim();
    const runId = createTidyRunId(new Date());

    expect(() =>
      quarantineBranch(root, "claude/merged", runId, undefined, {
        beforeRefTransaction: () => {
          throw new Error("simulated crash right after the journal begin line, before the transaction");
        }
      })
    ).toThrow();

    // Nothing changed: the transaction never ran.
    expect(run(root, ["rev-parse", "claude/merged"]).trim()).toBe(tip);
    expect(heads(root)).toContain("claude/merged");
    expect(readTidyRun(root, runId)?.branches ?? []).toHaveLength(0);

    const recovery = recoverTidyJournals(root);
    expect(recovery.rolledForward).toEqual([]);
    expect(recovery.rolledBack).toEqual([`branch claude/merged (run ${runId})`]);

    // Still nothing changed after recovery, and there is nothing to undo.
    expect(run(root, ["rev-parse", "claude/merged"]).trim()).toBe(tip);
    expect(heads(root)).toContain("claude/merged");
    expect(readTidyRun(root, runId)).toBeNull();
  });

  it("finishes an interrupted branch quarantine (crash after the ref transaction, before the manifest write)", () => {
    const root = repo();
    commitOn(root, "claude/merged", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/merged"]);
    const tip = run(root, ["rev-parse", "claude/merged"]).trim();

    const runId = createTidyRunId(new Date());
    expect(() =>
      quarantineBranch(root, "claude/merged", runId, undefined, {
        afterRefTransaction: () => {
          throw new Error("simulated crash after the atomic ref transaction");
        }
      })
    ).toThrow();

    // The ref transaction already committed: the branch is gone, quarantined
    // under the run's namespace, but no manifest entry exists yet.
    expect(heads(root)).not.toContain("claude/merged");
    expect(run(root, ["rev-parse", `refs/arcadia/tidy/${runId}/heads/claude/merged`]).trim()).toBe(tip);
    expect(readTidyRun(root, runId)?.branches ?? []).toHaveLength(0);

    const recovery = recoverTidyJournals(root);
    expect(recovery.rolledForward).toEqual([`branch claude/merged (run ${runId})`]);
    expect(recovery.rolledBack).toEqual([]);

    const manifest = readTidyRun(root, runId);
    expect(manifest?.branches).toEqual([
      { branch: "claude/merged", oldTip: tip, quarantineRef: `refs/arcadia/tidy/${runId}/heads/claude/merged` }
    ]);

    // Undo now works exactly as if the quarantine had completed cleanly.
    const undone = runTidyUndoCommand({ repo: root, run: runId });
    expect(undone.data.branchesRestored).toEqual(["claude/merged"]);
    expect(run(root, ["rev-parse", "claude/merged"]).trim()).toBe(tip);
  });

  it("is idempotent: recovering twice writes the manifest entry once", () => {
    const root = repo();
    commitOn(root, "claude/merged", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/merged"]);
    const runId = createTidyRunId(new Date());
    expect(() =>
      quarantineBranch(root, "claude/merged", runId, undefined, {
        afterRefTransaction: () => {
          throw new Error("simulated crash");
        }
      })
    ).toThrow();

    recoverTidyJournals(root);
    const secondPass = recoverTidyJournals(root);
    expect(secondPass.rolledForward).toEqual([]);
    expect(secondPass.rolledBack).toEqual([]);
    expect(readTidyRun(root, runId)?.branches).toHaveLength(1);
  });

  it("leaves the branch alone when nothing about the quarantine ever ran", () => {
    const root = repo();
    commitOn(root, "claude/merged", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/merged"]);
    const tip = run(root, ["rev-parse", "claude/merged"]).trim();
    const runId = createTidyRunId(new Date());

    // Simulate a crash between the journal begin-write and the ref
    // transaction itself never running, by writing the begin line through a
    // real quarantine call whose ref transaction is made to fail (a name
    // that can never resolve), so the transaction genuinely never commits.
    const nonExistentBranch = "claude/never-existed";
    const nothing = quarantineBranch(root, nonExistentBranch, runId);
    expect(nothing).toBeNull();
    // No journal line is written at all in this path (resolving the tip
    // fails before the journal write), so there is nothing to recover --
    // confirming recovery is a true no-op when nothing was ever attempted.
    const recovery = recoverTidyJournals(root);
    expect(recovery.rolledForward).toEqual([]);
    expect(recovery.rolledBack).toEqual([]);
    expect(run(root, ["rev-parse", "claude/merged"]).trim()).toBe(tip);
  });
});

describe("tidy journal — worktree quarantine crash recovery", () => {
  it("rolls back when the crash lands right after the pin ref, before either directory moves", () => {
    // Recovery runs at the start of every tidy invocation, including a plain
    // preview, and before the write interlock that would otherwise re-check
    // liveness. Finishing the move on the pin alone would relocate a
    // worktree nobody has re-assessed since the crash -- someone may have
    // resumed work in it in the meantime. With neither directory actually
    // moved yet, the safe and correct answer is to drop the orphan pin and
    // leave the worktree exactly where it was.
    const root = repo();
    commitOn(root, "claude/spent", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/spent"]);
    const tree = worktreeOn(root, "claude/spent", "spent");
    const head = run(tree, ["rev-parse", "HEAD"]).trim();
    const runId = createTidyRunId(new Date());

    expect(() =>
      quarantineWorktree(root, { path: tree, branch: "claude/spent", head }, runId, {
        afterPin: () => {
          throw new Error("simulated crash right after the pin ref lands");
        }
      })
    ).toThrow();

    // Nothing moved yet.
    expect(existsSync(tree)).toBe(true);
    expect(run(root, ["worktree", "list"])).toContain(tree);
    expect(readTidyRun(root, runId)?.worktrees ?? []).toHaveLength(0);

    const recovery = recoverTidyJournals(root);
    expect(recovery.rolledForward).toEqual([]);
    expect(recovery.rolledBack).toEqual([`worktree ${tree} (run ${runId})`]);

    // The worktree is untouched, exactly as if the crashed attempt had never
    // happened, and the orphan pin ref is gone.
    expect(existsSync(tree)).toBe(true);
    expect(run(root, ["worktree", "list"])).toContain(tree);
    expect(run(tree, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(readTidyRun(root, runId)).toBeNull();
  });

  it("rolls back (is a true no-op) when the pin ref itself never landed", () => {
    // The pin `update-ref` is the one atomic first step; if the journal
    // begin line was written but the process died before the ref call ever
    // ran, nothing at all has changed and recovery must do nothing.
    const root = repo();
    commitOn(root, "claude/spent", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/spent"]);
    const tree = worktreeOn(root, "claude/spent", "spent");
    const head = run(tree, ["rev-parse", "HEAD"]).trim();
    const runId = createTidyRunId(new Date());

    // Force the pin ref creation itself to fail: git stores loose refs as
    // files under a directory per path segment, so pre-creating a ref
    // literally named `.../worktrees` makes every ref `.../worktrees/<id>`
    // this run could ever pin unwritable -- `update-ref` genuinely refuses,
    // it is not a simulated failure.
    run(root, ["update-ref", `refs/arcadia/tidy/${runId}/worktrees`, head]);

    expect(() =>
      quarantineWorktree(root, { path: tree, branch: "claude/spent", head }, runId, {
        afterPin: () => {
          throw new Error("must never fire: the pin update-ref should fail first");
        }
      })
    ).not.toThrow();
    // quarantineWorktree returns null (not a throw) when the pin update-ref
    // fails outright, so assert on that instead of an exception.

    expect(existsSync(tree)).toBe(true);
    expect(run(root, ["worktree", "list"])).toContain(tree);

    const recovery = recoverTidyJournals(root);
    expect(recovery.rolledForward).toEqual([]);
    expect(recovery.rolledBack).toEqual([`worktree ${tree} (run ${runId})`]);
    expect(existsSync(tree)).toBe(true);
    expect(run(tree, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });

  it("finishes the quarantine when the crash lands after the tree move but before the admin move", () => {
    const root = repo();
    commitOn(root, "claude/spent", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/spent"]);
    const tree = worktreeOn(root, "claude/spent", "spent");
    writeFileSync(path.join(tree, "gitignored.txt"), "keepsake\n", "utf8");
    const head = run(tree, ["rev-parse", "HEAD"]).trim();
    const runId = createTidyRunId(new Date());

    expect(() =>
      quarantineWorktree(root, { path: tree, branch: "claude/spent", head }, runId, {
        afterTreeMove: () => {
          throw new Error("simulated crash after the tree half moved");
        }
      })
    ).toThrow();

    // The directory itself is already gone from its original location.
    expect(existsSync(tree)).toBe(false);
    expect(readTidyRun(root, runId)?.worktrees ?? []).toHaveLength(0);

    const recovery = recoverTidyJournals(root);
    expect(recovery.rolledForward).toEqual([`worktree ${tree} (run ${runId})`]);
    expect(recovery.rolledBack).toEqual([]);

    const manifest = readTidyRun(root, runId);
    expect(manifest?.worktrees).toHaveLength(1);
    expect(manifest?.worktrees[0]?.worktreePath).toBe(tree);

    // Byte-for-byte, including the file no `git status` would ever mention.
    const undone = runTidyUndoCommand({ repo: root, run: runId });
    expect(undone.data.worktreesRestored).toEqual([tree]);
    expect(existsSync(tree)).toBe(true);
    expect(readFileSync(path.join(tree, "gitignored.txt"), "utf8")).toBe("keepsake\n");
    expect(run(tree, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });

  it("finishes the quarantine when the crash lands after both directories moved but before the manifest write", () => {
    const root = repo();
    commitOn(root, "claude/spent", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/spent"]);
    const tree = worktreeOn(root, "claude/spent", "spent");
    const head = run(tree, ["rev-parse", "HEAD"]).trim();
    const runId = createTidyRunId(new Date());

    expect(() =>
      quarantineWorktree(root, { path: tree, branch: "claude/spent", head }, runId, {
        afterAdminMove: () => {
          throw new Error("simulated crash after both halves moved, before the manifest write");
        }
      })
    ).toThrow();

    expect(readTidyRun(root, runId)?.worktrees ?? []).toHaveLength(0);
    const recovery = recoverTidyJournals(root);
    expect(recovery.rolledForward).toEqual([`worktree ${tree} (run ${runId})`]);

    const undone = runTidyUndoCommand({ repo: root, run: runId });
    expect(undone.data.worktreesRestored).toEqual([tree]);
    expect(run(tree, ["rev-parse", "HEAD"]).trim()).toBe(head);
  });

  it("is idempotent across repeated recovery calls", () => {
    const root = repo();
    commitOn(root, "claude/spent", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/spent"]);
    const tree = worktreeOn(root, "claude/spent", "spent");
    const head = run(tree, ["rev-parse", "HEAD"]).trim();
    const runId = createTidyRunId(new Date());

    expect(() =>
      quarantineWorktree(root, { path: tree, branch: "claude/spent", head }, runId, {
        afterTreeMove: () => {
          throw new Error("simulated crash");
        }
      })
    ).toThrow();

    recoverTidyJournals(root);
    const secondPass = recoverTidyJournals(root);
    expect(secondPass.rolledForward).toEqual([]);
    expect(secondPass.rolledBack).toEqual([]);
    expect(readTidyRun(root, runId)?.worktrees).toHaveLength(1);
  });
});

describe("tidy journal — wired into runTidyCommand itself", () => {
  it("recovers a dangling worktree op the moment the next tidy invocation runs, preview or apply", () => {
    const root = repo();
    commitOn(root, "claude/spent", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/spent"]);
    const tree = worktreeOn(root, "claude/spent", "spent");
    const head = run(tree, ["rev-parse", "HEAD"]).trim();
    const runId = createTidyRunId(new Date());

    expect(() =>
      quarantineWorktree(root, { path: tree, branch: "claude/spent", head }, runId, {
        afterTreeMove: () => {
          throw new Error("simulated crash");
        }
      })
    ).toThrow();

    // A plain preview run (no --apply) still repairs the previous crash.
    const preview = data(runTidyCommand({ repo: root }));
    expect(preview.journalRecovery.rolledForward).toEqual([`worktree ${tree} (run ${runId})`]);

    // And it is a no-op from here on.
    const again = data(runTidyCommand({ repo: root }));
    expect(again.journalRecovery.rolledForward).toEqual([]);
    expect(again.journalRecovery.rolledBack).toEqual([]);

    const undone = runTidyUndoCommand({ repo: root, run: runId });
    expect(undone.data.worktreesRestored).toEqual([tree]);
  });

  // Root ignores directory write permission, so the `chmodSync` below would
  // not actually block the rename in a container that runs tests as root --
  // skip there rather than fail on an assumption that CI's real permission
  // model happens to make false.
  it.skipIf(process.getuid?.() === 0)(
    "reports a persistently failing op instead of throwing, and never attempts a second quarantine of the same stuck worktree",
    () => {
    const root = repo();
    commitOn(root, "claude/stuck", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/stuck"]);
    const tree = worktreeOn(root, "claude/stuck", "stuck");
    const head = run(tree, ["rev-parse", "HEAD"]).trim();
    const adminDir = run(tree, ["rev-parse", "--absolute-git-dir"]).trim();
    const worktreesDir = path.dirname(adminDir);
    const runId = createTidyRunId(new Date());

    expect(() =>
      quarantineWorktree(root, { path: tree, branch: "claude/stuck", head }, runId, {
        afterTreeMove: () => {
          throw new Error("simulated crash after the tree half moved");
        }
      })
    ).toThrow();

    // Remove write permission on `.git/worktrees` itself, so the admin
    // half's rename -- which needs to unlink its entry from this exact
    // directory -- fails with EACCES every time recovery retries it, the
    // way a real persistent EXDEV/EACCES would.
    chmodSync(worktreesDir, 0o555);
    try {
      const recovery = recoverTidyJournals(root);
      expect(recovery.failed).toHaveLength(1);
      expect(recovery.failed[0]).toContain(tree);
      expect(recovery.stuckWorktreePaths).toEqual([tree]);
      expect(recovery.rolledForward).toEqual([]);
      expect(recovery.rolledBack).toEqual([]);

      // A full apply run does not throw either, and does not attempt a
      // second, independent quarantine of the same worktree under a fresh
      // run id.
      const result = data(runTidyCommand({ repo: root, apply: true }));
      expect(result.journalRecovery.failed).toHaveLength(1);
      const entry = result.worktrees.find((w) => w.path === tree);
      expect(entry?.retired).toBe(false);
      expect(entry?.reason).toContain("Still stuck");

      const pinRefs = run(root, ["for-each-ref", "--format=%(refname)", "refs/arcadia/tidy"])
        .split("\n")
        .filter((line) => line.endsWith(`/worktrees/${path.basename(adminDir)}`));
      expect(pinRefs).toHaveLength(1);
    } finally {
      chmodSync(worktreesDir, 0o755);
    }
    }
  );

  it("repairs a torn trailing record before appending, so a later op never lands after unparsable debris", () => {
    const root = repo();
    commitOn(root, "claude/one", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/one"]);
    commitOn(root, "claude/two", "b.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/two"]);
    const runId = createTidyRunId(new Date());

    quarantineBranch(root, "claude/one", runId);

    // Simulate a crash mid-write on some earlier op: a torn fragment with no
    // trailing newline, appended directly rather than through
    // `quarantineBranch`/`quarantineWorktree`.
    const journalFile = path.join(gitCommonDir(root), "arcadia-tidy", "journal", `${runId}.ndjson`);
    writeFileSync(journalFile, '{"phase":"begin","op":"branch","id":"branch:torn', { flag: "a" });

    quarantineBranch(root, "claude/two", runId);

    // The torn fragment is gone, not preserved as an unparsable middle line:
    // every line in the file parses, and both branches are accounted for.
    const rawLines = readFileSync(journalFile, "utf8").split("\n").filter((line) => line.trim() !== "");
    for (const line of rawLines) expect(() => JSON.parse(line)).not.toThrow();
    const manifest = readTidyRun(root, runId);
    expect(manifest?.branches.map((b) => b.branch).sort()).toEqual(["claude/one", "claude/two"]);
  });

  it("finalizes (deletes) a run's journal once every op it recorded completed cleanly", () => {
    const root = repo();
    commitOn(root, "claude/done", "a.txt");
    run(root, ["merge", "-q", "--no-ff", "-m", "merge", "claude/done"]);
    worktreeOn(root, "claude/done", "done");

    const result = data(runTidyCommand({ repo: root, apply: true }));
    expect(result.run).not.toBeNull();
    const commonDir = gitCommonDir(root);
    const journalFile = path.join(commonDir, "arcadia-tidy", "journal", `${result.run}.ndjson`);
    expect(existsSync(journalFile)).toBe(false);
  });
});
