import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPushUnpushedCommand, type PushUnpushedCommandData } from "../src/commands/pushUnpushed.js";
import type { CommandSuccess } from "../src/cli/response.js";

const temporary: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.ARCADIA_WORKSPACE;
  process.env.PATH = originalPath;
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
  // A uniquely-generated directory, not a literal sibling name: this machine
  // routinely runs many concurrent agent sessions sharing one $TMPDIR, and a
  // fixed name collides with another session's fixture of the same name.
  const target = realpathSync(mkdtempSync(path.join(tmpdir(), `arcadia-push-${name}-`)));
  temporary.push(target);
  execFileSync("git", ["clone", "--quiet", origin, target], { encoding: "utf8" });
  run(target, ["config", "user.email", "test@example.com"]);
  run(target, ["config", "user.name", "Test"]);
  return target;
}

function commitOn(root: string, branch: string, file: string): void {
  run(root, ["checkout", "-q", "-b", branch]);
  writeFileSync(path.join(root, file), `${file}\n`, "utf8");
  run(root, ["add", "-A"]);
  run(root, ["commit", "-q", "-m", file]);
  run(root, ["checkout", "-q", "main"]);
}

function worktreeOn(root: string, branch: string, name: string): string {
  // `path.basename(root)` carries mkdtemp's random suffix, so this sibling
  // path is unique even under a $TMPDIR shared with concurrent sessions.
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

  it("reports pushed-untracked, not pushed, when the ref lands but local upstream tracking cannot be written", () => {
    // Reproduces the exact false positive found operating this repository:
    // `git push -u` can exit 0 after successfully updating the remote ref
    // while failing to write local upstream-tracking config (there, because
    // agent worktrees sandbox-protect `.git/config`). Trusting the exit code
    // alone would report "pushed" for a branch `arcadia tidy` still flags.
    //
    // A filesystem permission bit on `.git/config` itself does not reproduce
    // this: git writes config via lock-then-rename, which only needs write
    // access to the containing directory, not the target file. A fake `git`
    // that drops `-u` from the push (so the ref still lands) and fails the
    // explicit `branch --set-upstream-to` retry reproduces the actual
    // observed failure shape instead.
    const { origin, clone } = baseRepo();
    commitOn(clone, "claude/orphan", "feature.txt");

    const bin = fakeGitBlockingUpstreamTracking();
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    try {
      const result = data(runPushUnpushedCommand({ repo: clone, apply: true }));

      expect(result.items).toHaveLength(1);
      expect(result.items[0].outcome).toBe("pushed-untracked");
      expect(result.items[0].detail).toContain("safe on the remote");
      expect(result.items[0].detail).toContain("--set-upstream-to");

      // The safety-critical property still holds: the commit is on the remote.
      expect(run(origin, ["rev-parse", "claude/orphan"]).trim()).toBe(run(clone, ["rev-parse", "claude/orphan"]).trim());
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

/**
 * A `git` shim that behaves exactly like real git except for the two calls
 * `pushOne` makes to establish upstream tracking: it strips `-u`/`--set-upstream`
 * from a push (so the ref itself still lands normally) and fails an explicit
 * `branch --set-upstream-to` outright, mirroring a sandbox that blocks writes
 * to `.git/config` specifically rather than any push machinery.
 */
function fakeGitBlockingUpstreamTracking(): string {
  const bin = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-push-fake-git-")));
  temporary.push(bin);
  const realGit = execFileSync("command", ["-v", "git"], { encoding: "utf8", shell: "/bin/sh" }).trim();
  const script = path.join(bin, "git");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `REAL_GIT="${realGit}"`,
      'if [ "$1" = "push" ]; then',
      "  shift",
      "  filtered=\"\"",
      "  for a in \"$@\"; do",
      "    case \"$a\" in",
      "      -u|--set-upstream) ;;",
      "      *) filtered=\"$filtered $a\" ;;",
      "    esac",
      "  done",
      "  exec \"$REAL_GIT\" push $filtered",
      'elif [ "$1" = "branch" ] && [ "$2" = "--set-upstream-to" ]; then',
      "  echo 'error: could not lock config file .git/config: Operation not permitted' >&2",
      "  exit 1",
      "else",
      "  exec \"$REAL_GIT\" \"$@\"",
      "fi",
      ""
    ].join("\n"),
    "utf8"
  );
  chmodSync(script, 0o755);
  return bin;
}
