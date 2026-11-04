import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Interceptor = (command: string, args: readonly string[], cwd: string) => boolean;
const control = vi.hoisted(() => ({
  fail: null as null | Interceptor,
  calls: [] as string[][],
  alterListing: null as null | ((stdout: string) => string),
  alterations: 0
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((command: string, args: readonly string[], options: { cwd?: string }) => {
      control.calls.push([command, ...args]);
      if (control.fail?.(command, args, options?.cwd ?? "")) {
        return { status: 1, signal: null, stdout: "", stderr: "forced failure", pid: 0, output: [], error: undefined };
      }
      const result = (actual.spawnSync as (...a: unknown[]) => { stdout?: string })(command, args, options);
      // Only the batched branch listing (NUL-separated fields) is altered.
      const isBatchedListing = command === "git" && args[0] === "for-each-ref" && args.some((arg) => arg.includes("%00"));
      if (control.alterListing && isBatchedListing && typeof result.stdout === "string") {
        result.stdout = control.alterListing(result.stdout);
        control.alterations++;
      }
      return result;
    }) as typeof actual.spawnSync
  };
});

import { formatWorkingCopySafetyLines, scanProjectWorkingCopies, type WorkMonitorScanOptions } from "../src/workMonitoring/scanner.js";

const roots: string[] = [];
afterEach(() => {
  control.fail = null;
  control.calls = [];
  control.alterListing = null;
  control.alterations = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Origin plus a remote-backed branch, an unpublished branch and five linked worktrees. */
function createRepository(): { repository: string; worktrees: string[] } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-monitor-failures-"));
  roots.push(root);
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.email", "tests@example.com"]);
  git(repository, ["config", "user.name", "Arcadia Tests"]);
  writeFileSync(path.join(repository, "README.md"), "# Fixture\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "Initial commit"]);
  const remote = path.join(root, "remote.git");
  git(root, ["init", "--bare", "-b", "main", remote]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "-u", "origin", "main"]);
  git(repository, ["remote", "set-head", "origin", "main"]);
  const branch = (name: string, publish: boolean, subject = `Work on ${name}`) => {
    git(repository, ["switch", "-c", name, "main"]);
    writeFileSync(path.join(repository, `${name}.txt`), name);
    git(repository, ["add", "."]);
    git(repository, ["commit", "-m", subject]);
    if (publish) git(repository, ["push", "-u", "origin", name]);
    git(repository, ["switch", "main"]);
  };
  branch("published", true);
  branch("unpublished", false);
  branch("odd-subject", false, "before\x1fmiddle\x1eafter");
  const worktrees = [0, 1, 2, 3, 4].map((index) => {
    const target = path.join(root, `wt-${index}`);
    git(repository, ["worktree", "add", "-b", `wt-branch-${index}`, target, "main"]);
    return target;
  });
  return { repository, worktrees };
}

function scan(repository: string, refFacts?: WorkMonitorScanOptions["refFacts"]) {
  return scanProjectWorkingCopies(
    [{ id: "p", name: "Arcadia", repositoryPath: repository }],
    { includePullRequests: false, now: new Date("2026-08-03T00:00:00Z"), refFacts }
  );
}

describe("work monitor failure handling", () => {
  it("never reads a worktree whose status cannot be read as clean", () => {
    const { repository, worktrees } = createRepository();
    const index = git(worktrees[2], ["rev-parse", "--path-format=absolute", "--git-path", "index"]).trim();
    writeFileSync(index, "not a git index");

    for (const mode of [undefined, "per-ref"] as const) {
      const snapshot = scan(repository, mode);
      const copy = snapshot.repositories[0].workingCopies.find((entry) => entry.worktreePath?.endsWith("wt-2"));
      expect(copy).toMatchObject({ preservation: "unsaved", delivery: "working" });
      expect(copy?.summary).toContain("status could not be read");
      expect(formatWorkingCopySafetyLines(snapshot, 20).join("\n")).toContain("status could not be read");
      // Its neighbours are unaffected.
      expect(snapshot.repositories[0].workingCopies.find((entry) => entry.worktreePath?.endsWith("wt-3"))?.preservation).toBe("landed");
    }
  });

  it("retries a failed status once, sequentially, and keeps the true answer", () => {
    const { repository, worktrees } = createRepository();
    writeFileSync(path.join(worktrees[1], "dirty.txt"), "dirty\n");
    const baseline = scan(repository);
    expect(baseline.repositories[0].workingCopies.find((entry) => entry.worktreePath?.endsWith("wt-1"))?.preservation).toBe("unsaved");

    // The helper process is down, so every status runs in-process; each fails once.
    const failed = new Set<string>();
    control.fail = (command, args, cwd) => {
      if (command === process.execPath) return true;
      if (command !== "git" || args[0] !== "status" || failed.has(cwd)) return false;
      failed.add(cwd);
      return true;
    };
    expect(scan(repository)).toEqual(baseline);
    expect(failed.size).toBeGreaterThanOrEqual(5);
  });

  it("falls back to sequential reads when the parallel helper fails and gives the same snapshot", () => {
    const { repository, worktrees } = createRepository();
    writeFileSync(path.join(worktrees[0], "dirty.txt"), "dirty\n");
    const baseline = scan(repository);
    control.fail = (command) => command === process.execPath;
    expect(scan(repository)).toEqual(baseline);
    expect(control.calls.some(([command]) => command === process.execPath)).toBe(true);
  });

  it("asks each branch for its remote when the remote-ref listing fails", () => {
    const { repository } = createRepository();
    const baseline = scan(repository);
    expect(baseline.repositories[0].workingCopies.find((entry) => entry.branch === "published")?.remoteBranchExists).toBe(true);
    control.fail = (command, args) => command === "git" && args[0] === "for-each-ref" && args.includes("refs/remotes/origin/");
    expect(scan(repository)).toEqual(baseline);
  });

  it("uses the per-ref reads when the batched branch listing fails", () => {
    const { repository } = createRepository();
    const baseline = scan(repository);
    expect(baseline.repositories[0].workingCopies.some((entry) => entry.branch === "unpublished")).toBe(true);
    control.fail = (command, args) => command === "git" && args[0] === "for-each-ref" && args.some((arg) => arg.includes("%00"));
    expect(scan(repository)).toEqual(baseline);
  });

  it("falls back to the per-ref reads when one batched record keeps only its name and object id", () => {
    const { repository } = createRepository();
    const baseline = scan(repository);
    // The first record loses every field after its object id, so it no longer has the expected shape.
    control.alterListing = (stdout) => {
      const [first, ...rest] = stdout.split("\n");
      const [name, sha] = first.split("\0");
      return [`${name}\0${sha}`, ...rest].join("\n");
    };
    expect(scan(repository)).toEqual(baseline);
    expect(control.alterations).toBeGreaterThanOrEqual(1);
  });

  it("keeps a subject that contains the old record delimiters intact", () => {
    const { repository } = createRepository();
    const batched = scan(repository);
    const odd = batched.repositories[0].workingCopies.find((entry) => entry.branch === "odd-subject");
    expect(odd?.lastCommitSubject).toBe("before\x1fmiddle\x1eafter");
    expect(odd?.lastCommitAt).toMatch(/^\d{4}-/);
    expect(scan(repository, "without-ahead-behind")).toEqual(batched);
    expect(scan(repository, "per-ref")).toEqual(batched);
  });
});
