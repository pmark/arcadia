import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureGit } from "../scripts/preservation-fixture.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { scanProcForGit } from "../src/sessions/preservationStages.js";
import { fileIsHeldOpen, lsofFileHolders, procFdHolders, setFileHolderProbeForTests, type FileHolderProbe } from "../src/sessions/worktreeLiveness.js";
import { BRANCH, installTimeoutFixtureHooks, mockValidationWithRealGit, timeoutFixture } from "./preservationTimeoutFixture.js";

installTimeoutFixtureHooks();
afterEach(() => setFileHolderProbeForTests(null));

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
  expect(error.code).toBe("PRESERVATION_INDEX_LOCKED");
  expect(error.exitCode).toBe(1);
  expect(error.details).toMatchObject({ reason, lockPath, stage: "preserve.index-sync" });
  expect(String(error.details.remedy)).not.toContain("ARCADIA_PRESERVATION_GIT_TIMEOUT_MS");
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

  it("refuses a symlink to a real file at the lock path, leaving both the link and its target untouched", () => {
    const { f, lockPath, committed, failure, preserve } = durableCommitWithLock((lock, root) => {
      const target = path.join(root, "lock-target");
      writeFileSync(target, "not a lock\n");
      stale(target);
      symlinkSync(target, lock);
    });
    const target = path.join(f.root, "lock-target");
    const error = failure();
    expectTypedLock(error, "index_lock_malformed", lockPath);
    expect(error.details).toMatchObject({ retryable: false, lockKind: "symlink" });
    expect(lstatSync(lockPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(lockPath)).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("not a lock\n");
    expect(fixtureGit(f.candidate, ["rev-parse", BRANCH])).toBe(committed);

    rmSync(lockPath);
    expect(preserve().data.receipt).toMatchObject({ commitSha: committed });
    expect(readFileSync(target, "utf8")).toBe("not a lock\n");
  }, 120_000);

  it("refuses a fresh regular lock without probing or removing it", () => {
    const { lockPath, failure } = durableCommitWithLock((lock) => writeFileSync(lock, ""));
    const probed: string[] = [];
    setFileHolderProbeForTests((target) => { probed.push(target); return { status: "none" }; });
    const error = failure();
    expectTypedLock(error, "index_locked", lockPath);
    expect(error.details).toMatchObject({ retryable: true, liveness: "fresh" });
    expect(existsSync(lockPath)).toBe(true);
    expect(probed).toEqual([]);
  }, 120_000);

  it("keeps an old lock that a process still holds open, and refuses when the holder probe cannot tell", () => {
    const { f, lockPath, committed, failure, preserve } = durableCommitWithLock((lock) => { writeFileSync(lock, ""); stale(lock); });
    const probed: string[] = [];
    const probe = (answer: ReturnType<FileHolderProbe>): FileHolderProbe => (target) => { probed.push(target); return answer; };

    setFileHolderProbeForTests(probe({ status: "held", pids: [4242] }));
    const held = failure();
    expectTypedLock(held, "index_locked", lockPath);
    expect(held.details).toMatchObject({ retryable: true, liveness: "held", holderPids: [4242] });
    expect(existsSync(lockPath)).toBe(true);
    // The probe is asked about the lock file itself, by its real path.
    expect(probed).toEqual([realpathSync(lockPath)]);

    setFileHolderProbeForTests(probe({ status: "unknown", error: "lsof could not run: spawn lsof ENOENT" }));
    const unknown = failure();
    expectTypedLock(unknown, "index_locked", lockPath);
    expect(unknown.details).toMatchObject({ retryable: true, liveness: "unknown" });
    expect(String(unknown.details.livenessError)).toContain("file-holder probe: lsof could not run");
    expect(existsSync(lockPath)).toBe(true);

    // A probe that throws is "cannot tell" as well, never an untyped failure.
    setFileHolderProbeForTests(() => { throw new Error("probe crashed"); });
    const crashed = failure();
    expectTypedLock(crashed, "index_locked", lockPath);
    expect(String(crashed.details.livenessError)).toContain("probe crashed");
    expect(existsSync(lockPath)).toBe(true);
    expect(fixtureGit(f.candidate, ["rev-parse", BRANCH])).toBe(committed);

    // Old and positively unheld: removed, and the retry ends clean on the one commit.
    setFileHolderProbeForTests(probe({ status: "none" }));
    expect(preserve().data.receipt).toMatchObject({ commitSha: committed });
    expect(existsSync(lockPath)).toBe(false);
    expect(fixtureGit(f.candidate, ["rev-parse", BRANCH])).toBe(committed);
    expect(fixtureGit(f.candidate, ["rev-list", "--count", `${f.base}..${BRANCH}`])).toBe("1");
    expect(fixtureGit(f.candidate, ["status", "--porcelain"])).toBe("");
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

describe("file-holder probe", () => {
  const errno = (code: string) => Object.assign(new Error(code), { code });

  it("finds a Linux process whose descriptor names the file, skipping exited or uninspectable ones", () => {
    const reader = (overrides: Partial<Parameters<typeof procFdHolders>[1]> = {}) => ({
      list: () => ["1", "self", "200", "300", "400"],
      fds: (pid: string) => { if (pid === "300") throw errno("EACCES"); if (pid === "400") throw errno("ENOENT"); return ["0", "3"]; },
      link: (pid: string, fd: string) => (pid === "200" && fd === "3" ? "/work/.git/index.lock" : "/dev/null"),
      ...overrides
    });
    expect(procFdHolders("/work/.git/index.lock", reader())).toEqual({ status: "held", pids: [200] });
    expect(procFdHolders("/elsewhere", reader())).toEqual({ status: "none" });
    expect(procFdHolders("/work/.git/index.lock", reader({ list: () => { throw errno("EACCES"); } }))).toMatchObject({ status: "unknown" });
    expect(procFdHolders("/work/.git/index.lock", reader({ fds: () => { throw errno("EIO"); } }))).toMatchObject({ status: "unknown" });
    expect(procFdHolders("/work/.git/index.lock", reader({ link: () => { throw errno("ELOOP"); } }))).toMatchObject({ status: "unknown" });
  });

  it("reads lsof fail-closed: only a silent exit 1 is none", () => {
    const run = (status: number | null, stdout = "", stderr = "", error?: Error) => () => ({ status, stdout, stderr, error });
    expect(lsofFileHolders("/work/index.lock", run(1))).toEqual({ status: "none" });
    expect(lsofFileHolders("/work/index.lock", run(0, "p123\nf3\np456\nf7\n"))).toEqual({ status: "held", pids: [123, 456] });
    expect(lsofFileHolders("/work/index.lock", run(1, "", "lsof: WARNING: can't stat()"))).toMatchObject({ status: "unknown" });
    expect(lsofFileHolders("/work/index.lock", run(null, "", "", new Error("spawnSync lsof ETIMEDOUT")))).toMatchObject({ status: "unknown" });
    expect(lsofFileHolders("/work/index.lock", run(0, "garbage\n"))).toMatchObject({ status: "unknown" });
    expect(lsofFileHolders("/work/index.lock", run(0, ""))).toMatchObject({ status: "unknown" });
    expect(lsofFileHolders("/work/\u00e9/index.lock", () => { throw new Error("must not run"); })).toMatchObject({ status: "unknown" });
  });

  it("answers unknown for a path it cannot resolve", () => {
    expect(fileIsHeldOpen(path.join(realpathSync(process.cwd()), "definitely-missing-lock"))).toMatchObject({ status: "unknown" });
  });
});
