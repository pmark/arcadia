import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPushUnpushedCommand, type PushUnpushedCommandData } from "../src/commands/pushUnpushed.js";
import type { CommandSuccess } from "../src/cli/response.js";

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

function data(response: CommandSuccess<PushUnpushedCommandData>): PushUnpushedCommandData {
  return response.data;
}

/** A bare repository standing in for `origin`. */
function bareOrigin(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-push-origin-")));
  temporary.push(root);
  run(root, ["init", "--bare", "--initial-branch=main", "--quiet"]);
  return root;
}

function cloneOf(origin: string, name: string): string {
  const target = path.join(origin, "..", name);
  execFileSync("git", ["clone", "--quiet", origin, target], { encoding: "utf8" });
  const resolved = realpathSync(target);
  temporary.push(resolved);
  run(resolved, ["config", "user.email", "test@example.com"]);
  run(resolved, ["config", "user.name", "Test"]);
  return resolved;
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

/** A clone with a base commit already pushed to `origin/main`. */
function baseRepo(): { origin: string; clone: string } {
  const origin = bareOrigin();
  const clone = cloneOf(origin, "clone");
  writeFileSync(path.join(clone, "README.md"), "# base\n", "utf8");
  run(clone, ["add", "-A"]);
  run(clone, ["commit", "-q", "-m", "base"]);
  run(clone, ["push", "-q", "origin", "main"]);
  return { origin, clone };
}

describe("arcadia push-unpushed", () => {
  it("reports what it would push without --apply, and pushes nothing", () => {
    const { clone } = baseRepo();
    commitOn(clone, "claude/orphan", "feature.txt");

    const result = data(runPushUnpushedCommand({ repo: clone }));

    expect(result.applied).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: "branch", branch: "claude/orphan", outcome: "would-push" });

    // Nothing was actually pushed.
    expect(run(clone, ["ls-remote", "origin", "refs/heads/claude/orphan"]).trim()).toBe("");
  });

  it("pushes an unpushed standalone branch with --apply, and sets it as upstream", () => {
    const { origin, clone } = baseRepo();
    commitOn(clone, "claude/orphan", "feature.txt");

    const result = data(runPushUnpushedCommand({ repo: clone, apply: true }));

    expect(result.applied).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: "branch", branch: "claude/orphan", outcome: "pushed" });

    const remoteTip = run(origin, ["rev-parse", "claude/orphan"]).trim();
    const localTip = run(clone, ["rev-parse", "claude/orphan"]).trim();
    expect(remoteTip).toBe(localTip);
    expect(run(clone, ["rev-parse", "--abbrev-ref", "claude/orphan@{upstream}"]).trim()).toBe("origin/claude/orphan");
  });

  it("pushes an unpushed worktree branch with --apply", () => {
    const { origin, clone } = baseRepo();
    commitOn(clone, "claude/worktree-branch", "feature.txt");
    worktreeOn(clone, "claude/worktree-branch", "wt");

    const result = data(runPushUnpushedCommand({ repo: clone, apply: true }));

    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("worktree");
    expect(result.items[0].outcome).toBe("pushed");
    expect(run(origin, ["rev-parse", "claude/worktree-branch"]).trim()).toBe(run(clone, ["rev-parse", "claude/worktree-branch"]).trim());
  });

  it("is idempotent: a second run finds nothing left to push", () => {
    const { clone } = baseRepo();
    commitOn(clone, "claude/orphan", "feature.txt");

    runPushUnpushedCommand({ repo: clone, apply: true });
    const second = data(runPushUnpushedCommand({ repo: clone, apply: true }));

    expect(second.items).toHaveLength(0);
  });

  it("never touches a branch that is already merged", () => {
    const { clone } = baseRepo();
    commitOn(clone, "claude/done", "feature.txt");
    run(clone, ["merge", "-q", "--no-ff", "-m", "merge", "claude/done"]);
    run(clone, ["push", "-q", "origin", "main"]);

    const result = data(runPushUnpushedCommand({ repo: clone, apply: true }));

    expect(result.items).toHaveLength(0);
  });

  it("never touches a branch that already has a remote copy", () => {
    const { clone } = baseRepo();
    commitOn(clone, "claude/already-pushed", "feature.txt");
    run(clone, ["push", "-q", "-u", "origin", "claude/already-pushed"]);

    const result = data(runPushUnpushedCommand({ repo: clone, apply: true }));

    expect(result.items).toHaveLength(0);
  });

  it("never touches a worktree with uncommitted changes", () => {
    const { clone } = baseRepo();
    commitOn(clone, "claude/dirty", "feature.txt");
    const wt = worktreeOn(clone, "claude/dirty", "wt");
    writeFileSync(path.join(wt, "uncommitted.txt"), "scratch\n", "utf8");

    const result = data(runPushUnpushedCommand({ repo: clone, apply: true }));

    expect(result.items).toHaveLength(0);
  });

  it("reports a clean push failure without touching other items", () => {
    const { origin, clone } = baseRepo();

    // Simulate a same-named branch already diverging on the remote — the one
    // case a purely local `pushed` check cannot see (no upstream is
    // configured locally, but the name is already taken with different
    // content). A plain push must refuse this rather than overwrite it.
    const other = cloneOf(origin, "other");
    commitOn(other, "claude/collides", "elsewhere.txt");
    run(other, ["push", "-q", "origin", "claude/collides"]);

    commitOn(clone, "claude/collides", "feature.txt");
    commitOn(clone, "claude/orphan", "feature2.txt");

    const result = data(runPushUnpushedCommand({ repo: clone, apply: true }));

    const collided = result.items.find((item) => item.branch === "claude/collides");
    const orphan = result.items.find((item) => item.branch === "claude/orphan");
    expect(collided?.outcome).toBe("failed");
    expect(orphan?.outcome).toBe("pushed");

    // The remote branch that already existed is untouched by the failed push.
    expect(run(origin, ["rev-parse", "claude/collides"]).trim()).toBe(run(other, ["rev-parse", "claude/collides"]).trim());
  });
});
