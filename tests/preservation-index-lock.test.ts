import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureGit } from "../scripts/preservation-fixture.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { scanProcForGit } from "../src/sessions/preservationStages.js";
import { BRANCH, installTimeoutFixtureHooks, mockValidationWithRealGit, timeoutFixture } from "./preservationTimeoutFixture.js";

installTimeoutFixtureHooks();

/** Make the preservation commit durable, then leave the post-commit index sync
 * blocked by whatever shape `shape` puts at the real `index.lock` path. */
function durableCommitWithLock(shape: (lockPath: string, root: string) => void) {
  mockValidationWithRealGit();
  const fixture = timeoutFixture();
  fixture.timeoutAt("preserve.index-sync", "read-tree", true);
  const committed = fixtureGit(fixture.f.candidate, ["rev-parse", BRANCH]);
  rmSync(fixture.lockPath, { force: true });
  shape(fixture.lockPath, fixture.f.root);
  return { ...fixture, committed };
}

const stale = (target: string) => {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(target, old, old);
};

function expectTypedLock(error: ArcadiaError, reason: string, lockPath: string) {
  expect(error, `${error?.message} ${JSON.stringify(error?.details)}`.slice(0, 600)).toBeInstanceOf(ArcadiaError);
  expect(error.code).toBe("PRESERVATION_GIT_TIMEOUT");
  expect(error.details).toMatchObject({ reason, lockPath, stage: "preserve.index-sync" });
  expect(String(error.details.remedy)).toContain("already durable");
}

describe("preservation index lock safety", () => {
  it("refuses a directory at the lock path with a typed error and never removes it", () => {
    const { f, lockPath, committed, failure, preserve } = durableCommitWithLock((lock) => { mkdirSync(lock); stale(lock); });
    const error = failure();
    expectTypedLock(error, "index_lock_malformed", lockPath);
    expect(error.details).toMatchObject({ retryable: false, lockKind: "directory" });
    expect(lstatSync(lockPath).isDirectory()).toBe(true);
    expect(fixtureGit(f.candidate, ["rev-parse", BRANCH])).toBe(committed);

    rmSync(lockPath, { recursive: true });
    expect(preserve().data.receipt).toMatchObject({ commitSha: committed });
  }, 120_000);

  it("refuses a dangling symlink at the lock path with a typed error instead of reading it as no lock", () => {
    const { f, lockPath, committed, failure, preserve } = durableCommitWithLock((lock, root) => symlinkSync(path.join(root, "missing-target"), lock));
    const error = failure();
    expectTypedLock(error, "index_lock_malformed", lockPath);
    expect(error.details).toMatchObject({ retryable: false, lockKind: "symlink" });
    expect(lstatSync(lockPath).isSymbolicLink()).toBe(true);
    expect(fixtureGit(f.candidate, ["rev-parse", BRANCH])).toBe(committed);

    rmSync(lockPath);
    expect(preserve().data.receipt).toMatchObject({ commitSha: committed });
  }, 120_000);

  it("keeps an old lock while a live Git process runs in the candidate, then removes it once that process is gone", async () => {
    const { f, lockPath, committed, failure, preserve } = durableCommitWithLock((lock) => { writeFileSync(lock, ""); stale(lock); });
    // A Git process still running in the candidate (as `git commit` waiting on
    // an editor would be): its lock is old by mtime but not abandoned.
    const live = spawn("git", ["hash-object", "--stdin"], { cwd: f.candidate, stdio: ["pipe", "ignore", "ignore"] });
    const exited = new Promise<void>((resolve) => live.on("exit", () => resolve()));
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const error = failure();
      expectTypedLock(error, "index_locked", lockPath);
      expect(error.details).toMatchObject({ retryable: true, liveness: "live" });
      expect(error.details.liveGitPids).toContain(live.pid);
      // A long-lived fsmonitor daemon would hold this forever: the remedy names it.
      expect(String(error.details.remedy)).toContain("fsmonitor--daemon stop");
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      live.stdin?.end();
      await exited;
    }
    expect(preserve().data.receipt).toMatchObject({ commitSha: committed });
    expect(existsSync(lockPath)).toBe(false);
  }, 120_000);
});

describe("Linux /proc liveness scan", () => {
  const within = (dir: string) => dir === "/work" || dir.startsWith("/work/");
  const errno = (code: string) => Object.assign(new Error(code), { code });
  const proc = (overrides: Partial<Parameters<typeof scanProcForGit>[1]> = {}) => ({
    list: () => ["1", "self", "200", "300"],
    comm: (pid: string) => (pid === "300" ? "bash" : "git"),
    cwd: (pid: string) => (pid === "200" ? "/work/sub" : "/elsewhere"),
    ...overrides
  });

  it("finds a git process whose cwd is in the worktree, and none otherwise", () => {
    expect(scanProcForGit(within, proc())).toEqual({ status: "live", pids: [200] });
    expect(scanProcForGit(within, proc({ cwd: () => "/elsewhere" }))).toEqual({ status: "none" });
  });

  it("reports unknown (treated live), never an untyped throw, when /proc cannot be listed", () => {
    const result = scanProcForGit(within, proc({ list: () => { throw errno("EACCES"); } }));
    expect(result).toMatchObject({ status: "unknown" });
  });

  it("treats a git process whose cwd cannot be read (EACCES/EPERM) as unknown, but skips one that exited", () => {
    for (const code of ["EACCES", "EPERM"]) {
      const result = scanProcForGit(within, proc({ cwd: (pid) => { if (pid === "1") throw errno(code); return "/elsewhere"; } }));
      expect(result, code).toMatchObject({ status: "unknown" });
    }
    const exited = scanProcForGit(within, proc({ cwd: (pid) => { if (pid === "1") throw errno("ENOENT"); return "/elsewhere"; } }));
    expect(exited).toEqual({ status: "none" });
  });
});
