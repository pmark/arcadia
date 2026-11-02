import { execFileSync } from "node:child_process";
import { scopeToRepository } from "../src/commands/workMonitor.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { WorkMonitorScanOptions } from "../src/workMonitoring/scanner.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatWorkingCopySafetyLines,
  listLandedRepositoryWork,
  scanProjectWorkingCopies
} from "../src/workMonitoring/scanner.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("working-copy safety monitor", () => {
  it("batched Git facts match the original per-ref reads on every kind of working copy", () => {
    const repository = createDifferentialRepository();
    const projects = [{ id: "project-1", name: "Arcadia", repositoryPath: repository }];
    const refsBefore = git(repository, ["for-each-ref"]) + git(repository, ["reflog", "--all"]);
    const scan = (refFacts: NonNullable<WorkMonitorScanOptions["refFacts"]>) =>
      scanProjectWorkingCopies(projects, { includePullRequests: false, now: new Date("2026-08-03T00:00:00Z"), refFacts });

    const reference = scan("per-ref");
    const copies = reference.repositories[0].workingCopies;
    // The fixture must actually exercise each case, or equality proves nothing.
    expect(new Set(copies.map((copy) => copy.preservation))).toEqual(new Set(["unsaved", "local_only", "pushed", "landed"]));
    const byBranch = (name: string) => copies.find((copy) => copy.branch === name);
    expect(byBranch("gone")).toMatchObject({ upstream: null, aheadOfUpstream: null, preservation: "local_only" });
    expect(byBranch("diverged")).toMatchObject({ upstream: "origin/diverged", aheadOfUpstream: 1, behindUpstream: 1 });
    expect(byBranch("pushed-only")?.preservation).toBe("pushed");
    expect(byBranch("unpublished-remote")).toMatchObject({ upstream: null, remoteBranchExists: true });
    expect(byBranch("tracks-local")?.upstream).toBe("main");
    expect(copies.filter((copy) => copy.detached).length).toBeGreaterThanOrEqual(3);
    expect(copies.some((copy) => copy.changes.staged > 0 && copy.changes.unstaged > 0 && copy.changes.untracked > 0)).toBe(true);
    expect(copies.filter((copy) => copy.worktreePath).length).toBeGreaterThanOrEqual(8);
    expect(byBranch("merged-attached")?.preservation).toBe("landed");
    expect(copies.some((copy) => copy.branch === "merged-unattached")).toBe(false);

    expect(scan("auto")).toEqual(reference);
    expect(scan("without-ahead-behind")).toEqual(reference);
    expect(git(repository, ["for-each-ref"]) + git(repository, ["reflog", "--all"])).toBe(refsBefore);
  });

  it("finds dirty linked worktrees and explains their changed area", () => {
    const repository = createRepository();
    const linked = path.join(path.dirname(repository), "linked");
    git(repository, ["worktree", "add", "-b", "agent/dashboard", linked]);
    mkdirSync(path.join(linked, "apps", "dashboard"), { recursive: true });
    writeFileSync(path.join(linked, "apps", "dashboard", "page.tsx"), "export default 1;\n");

    const snapshot = scanProjectWorkingCopies(
      [{ id: "project-1", name: "Arcadia", repositoryPath: repository }],
      { includePullRequests: false, now: new Date("2026-08-03T00:00:00Z") }
    );
    const dirty = snapshot.repositories[0].workingCopies.find((copy) => copy.branch === "agent/dashboard");

    expect(dirty?.preservation).toBe("unsaved");
    expect(dirty?.changes.untracked).toBe(1);
    expect(dirty?.changes.areas).toContain("app dashboard");
    expect(dirty?.recommendedAction).toContain("commit");
    expect(formatWorkingCopySafetyLines(snapshot)[0]).toContain("Arcadia / agent/dashboard");
  });

  it("finds a local-only branch even when it has no worktree", () => {
    const repository = createRepository();
    git(repository, ["switch", "-c", "agent/forgotten"]);
    mkdirSync(path.join(repository, "src", "orientation"), { recursive: true });
    writeFileSync(path.join(repository, "src", "orientation", "monitor.ts"), "export const safe = true;\n");
    git(repository, ["add", "src/orientation/monitor.ts"]);
    git(repository, ["commit", "-m", "Add monitor"]);
    git(repository, ["switch", "main"]);

    const snapshot = scanProjectWorkingCopies(
      [{ id: "project-1", name: "Arcadia", repositoryPath: repository }],
      { includePullRequests: false }
    );
    const forgotten = snapshot.repositories[0].workingCopies.find((copy) => copy.branch === "agent/forgotten");

    expect(forgotten?.worktreePath).toBeNull();
    expect(forgotten?.commitsNotInBase).toBe(1);
    expect(forgotten?.preservation).toBe("local_only");
    expect(forgotten?.delivery).toBe("needs_preservation");
    expect(forgotten?.changes.areas).toContain("orientation");
  });

  it("reports missing Project repository configuration without aborting the scan", () => {
    const snapshot = scanProjectWorkingCopies(
      [{ id: "project-1", name: "Unconfigured", repositoryPath: null }],
      { includePullRequests: false }
    );

    expect(snapshot.totals.configurationErrors).toBe(1);
    expect(snapshot.repositories[0].error).toContain("No repository path");
    expect(formatWorkingCopySafetyLines(snapshot)[0]).toContain("Unconfigured");
  });

  it("reports first-parent work landed during the previous local-day window", () => {
    const repository = createRepository();
    git(repository, ["switch", "-c", "feature/accurate-report"]);
    writeFileSync(path.join(repository, "report.ts"), "export const accurate = true;\n");
    git(repository, ["add", "report.ts"]);
    gitAt(repository, ["commit", "-m", "Add landed-work reporting"], "2026-08-10T12:00:00-07:00");
    git(repository, ["switch", "main"]);
    gitAt(repository, [
      "merge", "--no-ff", "feature/accurate-report",
      "-m", "Merge pull request #12 from test/accurate-report",
      "-m", "Show merged work in the Morning Packet"
    ], "2026-08-10T15:00:00-07:00");

    const snapshot = scanProjectWorkingCopies(
      [{ id: "project-1", name: "Arcadia", repositoryPath: repository }],
      { includePullRequests: false }
    );
    const landed = listLandedRepositoryWork(snapshot, {
      start: "2026-08-10T07:00:00.000Z",
      end: "2026-08-11T07:00:00.000Z"
    });

    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({
      projectId: "project-1",
      projectName: "Arcadia",
      summary: "Merged PR #12: Show merged work in the Morning Packet"
    });
  });
});

function createRepository(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-work-monitor-"));
  roots.push(root);
  const repository = path.join(root, "repository");
  mkdirSync(repository);
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.email", "tests@example.com"]);
  git(repository, ["config", "user.name", "Arcadia Tests"]);
  writeFileSync(path.join(repository, "README.md"), "# Fixture\n");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "-m", "Initial commit"]);
  return repository;
}

function createDifferentialRepository(): string {
  const repository = createRepository();
  const root = path.dirname(repository);
  const remote = path.join(root, "remote.git");
  git(root, ["init", "--bare", "-b", "main", remote]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "-u", "origin", "main"]);
  git(repository, ["remote", "set-head", "origin", "main"]);
  const commit = (cwd: string, file: string, message: string) => {
    writeFileSync(path.join(cwd, file), message + "\n");
    git(cwd, ["add", file]);
    git(cwd, ["commit", "-m", message]);
  };
  const branchFrom = (name: string, files: string[]) => {
    git(repository, ["switch", "-c", name, "main"]);
    for (const file of files) commit(repository, file, `Work on ${name} ${file}`);
    git(repository, ["switch", "main"]);
  };

  branchFrom("pushed-only", ["a.ts", "a2.ts"]);
  git(repository, ["push", "-u", "origin", "pushed-only"]);
  branchFrom("diverged", ["b.ts"]);
  git(repository, ["push", "-u", "origin", "diverged"]);
  git(repository, ["switch", "diverged"]);
  commit(repository, "b-local.ts", "Local-only follow-up");
  git(repository, ["switch", "main"]);
  const other = path.join(root, "other-clone");
  git(root, ["clone", remote, other]);
  git(other, ["config", "user.email", "tests@example.com"]);
  git(other, ["config", "user.name", "Arcadia Tests"]);
  git(other, ["switch", "diverged"]);
  commit(other, "b-remote.ts", "Remote-only follow-up");
  git(other, ["push", "origin", "diverged"]);
  git(repository, ["fetch", "origin"]);

  branchFrom("no-upstream", ["c.ts"]);
  branchFrom("gone", ["d.ts"]);
  git(repository, ["push", "-u", "origin", "gone"]);
  git(repository, ["push", "origin", "--delete", "gone"]);
  git(repository, ["fetch", "--prune", "origin"]);
  branchFrom("unpublished-remote", ["e.ts"]);
  git(repository, ["push", "origin", "unpublished-remote"]);
  branchFrom("tracks-local", ["f.ts"]);
  git(repository, ["branch", "--set-upstream-to=main", "tracks-local"]);
  branchFrom("slash/nested", ["g.ts"]);
  git(repository, ["push", "-u", "origin", "slash/nested"]);

  // Merged into main: one attached to a worktree, one not (skipped by the scan).
  branchFrom("merged-unattached", ["h.ts"]);
  branchFrom("merged-attached", ["i.ts"]);
  git(repository, ["merge", "--no-ff", "merged-unattached", "-m", "Merge unattached"]);
  git(repository, ["merge", "--no-ff", "merged-attached", "-m", "Merge attached"]);
  git(repository, ["push", "origin", "main"]);

  const worktree = (name: string, branch?: string) => {
    const target = path.join(root, name);
    git(repository, branch ? ["worktree", "add", target, branch] : ["worktree", "add", "--detach", target, "main"]);
    return target;
  };
  worktree("wt-pushed", "pushed-only");
  worktree("wt-diverged", "diverged");
  worktree("wt-merged", "merged-attached");
  worktree("wt-gone", "gone");
  const dirty = worktree("wt-dirty", "no-upstream");
  writeFileSync(path.join(dirty, "c.ts"), "changed\n");
  writeFileSync(path.join(dirty, "staged.ts"), "staged\n");
  git(dirty, ["add", "staged.ts"]);
  writeFileSync(path.join(dirty, "staged.ts"), "staged and edited\n");
  mkdirSync(path.join(dirty, "src", "workMonitoring"), { recursive: true });
  writeFileSync(path.join(dirty, "src", "workMonitoring", "new.ts"), "untracked\n");
  const detachedMain = worktree("wt-detached-main");
  const detachedAtBranch = worktree("wt-detached-branch");
  git(detachedAtBranch, ["checkout", "--detach", "pushed-only"]);
  const detachedUnique = worktree("wt-detached-unique");
  commit(detachedUnique, "detached.ts", "Detached-only commit");
  git(detachedUnique, ["checkout", "--detach"]);
  expect(detachedMain).toBeTruthy();
  branchFrom("missing-worktree", ["j.ts"]);
  const missing = worktree("wt-missing", "missing-worktree");
  rmSync(missing, { recursive: true, force: true });
  return repository;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitAt(cwd: string, args: string[], isoDate: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
  });
}

describe("scopeToRepository", () => {
  const projects = [
    { id: "a", name: "Arcadia", repositoryPath: "/tmp/scope-arcadia" },
    { id: "f", name: "Fixture", repositoryPath: "/tmp/scope-fixture" },
    { id: "n", name: "No repo", repositoryPath: null }
  ];

  it("keeps only the Project that owns the repository, so an agent never sees another Project's paths", () => {
    expect(scopeToRepository(projects, "/tmp/scope-fixture").map((p) => p.id)).toEqual(["f"]);
  });

  it("refuses a repository no Project owns instead of returning an empty scan", () => {
    expect(() => scopeToRepository(projects, "/tmp/scope-elsewhere")).toThrow(/No active Project owns/);
  });

  it("recognizes a prepared worktree as owned by its Project's repository (#478)", () => {
    const repository = createRepository();
    const linked = path.join(path.dirname(repository), "linked");
    git(repository, ["worktree", "add", "-b", "agent/prepared", linked]);

    const real = [
      { id: "a", name: "Arcadia", repositoryPath: repository },
      { id: "o", name: "Other", repositoryPath: createRepository() }
    ];

    expect(scopeToRepository(real, linked).map((p) => p.id)).toEqual(["a"]);
  });

  it("refuses a worktree of a repository no Project owns", () => {
    const unowned = createRepository();
    const linked = path.join(path.dirname(unowned), "linked");
    git(unowned, ["worktree", "add", "-b", "agent/unowned", linked]);

    expect(() => scopeToRepository(
      [{ id: "a", name: "Arcadia", repositoryPath: createRepository() }],
      linked
    )).toThrow(/No active Project owns/);
  });

  it("refuses a directory whose .git gitfile points at an owned repository (#478)", () => {
    const repository = createRepository();
    const impostor = path.join(path.dirname(repository), "impostor");
    mkdirSync(impostor);
    writeFileSync(path.join(impostor, ".git"), `gitdir: ${path.join(repository, ".git")}\n`);

    expect(() => scopeToRepository(
      [{ id: "a", name: "Arcadia", repositoryPath: repository }],
      impostor
    )).toThrow(/No active Project owns/);
  });

  it("ignores an inherited GIT_DIR that points at an owned repository (#478)", () => {
    const owned = createRepository();
    const unrelated = createRepository();
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(owned, ".git");
    try {
      expect(() => scopeToRepository(
        [{ id: "a", name: "Arcadia", repositoryPath: owned }],
        unrelated
      )).toThrow(/No active Project owns/);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  });

  it("refuses a registered worktree path whose directory became an independent repository (#478)", () => {
    const repository = createRepository();
    const linked = path.join(path.dirname(repository), "linked");
    git(repository, ["worktree", "add", "-b", "agent/replaced", linked]);
    rmSync(linked, { recursive: true, force: true });
    mkdirSync(linked);
    git(linked, ["init", "-b", "main"]);

    expect(() => scopeToRepository(
      [{ id: "a", name: "Arcadia", repositoryPath: repository }],
      linked
    )).toThrow(/No active Project owns/);
  });
});
