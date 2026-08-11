import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
