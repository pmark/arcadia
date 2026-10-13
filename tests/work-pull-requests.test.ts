import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listOutstandingPullRequests,
  buildPullRequestBriefing,
  derivePullRequestReadiness,
  normalizeCheck,
  normalizePullRequest
} from "../src/workMonitoring/pullRequests.js";
import { rollup } from "./helpers/statusCheckRollups.js";

describe("outstanding pull-request readiness", () => {
  it("rates an approved clean PR as merge-ready", () => {
    expect(derivePullRequestReadiness({
      isDraft: false,
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      checks: [{ name: "CI", status: "COMPLETED", conclusion: "SUCCESS", url: null }]
    })).toBe("merge_ready");
  });

  it.each(["NEUTRAL", "SKIPPED", "STALE", "STARTUP_FAILURE"])("does not rate a PR merge-ready when a completed check concluded %s", (conclusion) => {
    expect(derivePullRequestReadiness({
      isDraft: false,
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      checks: [
        { name: "CI", status: "COMPLETED", conclusion: "SUCCESS", url: null },
        { name: "optional", status: "COMPLETED", conclusion, url: null }
      ]
    })).toBe("checks_failing");
  });

  it("does not rate HAS_HOOKS as merge-ready even when approved with green checks", () => {
    expect(derivePullRequestReadiness({
      isDraft: false,
      mergeStateStatus: "HAS_HOOKS",
      reviewDecision: "APPROVED",
      checks: [{ name: "CI", status: "COMPLETED", conclusion: "SUCCESS", url: null }]
    })).toBe("ready");
  });

  it("prioritizes conflicts and failing checks over draft state", () => {
    expect(derivePullRequestReadiness({
      isDraft: true,
      mergeStateStatus: "DIRTY",
      reviewDecision: null,
      checks: []
    })).toBe("blocked");
    expect(derivePullRequestReadiness({
      isDraft: true,
      mergeStateStatus: "UNKNOWN",
      reviewDecision: null,
      checks: [{ name: "CI", status: "COMPLETED", conclusion: "FAILURE", url: null }]
    })).toBe("checks_failing");
  });

  it("normalizes GitHub data into a project-scoped plain-English record", () => {
    const pullRequest = normalizePullRequest(
      { id: "project-1", name: "Arcadia", repositoryPath: "/tmp/arcadia" },
      "/tmp/arcadia",
      "pmark/arcadia",
      {
        number: 42,
        title: "Show outstanding pull requests",
        url: "https://github.com/pmark/arcadia/pull/42",
        state: "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        headRefName: "agent/pr-dashboard",
        baseRefName: "main",
        author: { login: "pmark" },
        reviewDecision: "REVIEW_REQUIRED",
        createdAt: "2026-08-03T10:00:00Z",
        updatedAt: "2026-08-03T11:00:00Z",
        statusCheckRollup: [{ name: "CI", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci" }]
      }
    );

    expect(pullRequest).toMatchObject({
      projectName: "Arcadia",
      repository: "pmark/arcadia",
      number: 42,
      headBranch: "agent/pr-dashboard",
      readiness: "ready",
      readinessLabel: "READY FOR REVIEW"
    });
    expect(pullRequest?.summary).toContain("waiting for review");
  });

  it("computes deterministic material facts for the briefing layer", () => {
    const pullRequest = normalizePullRequest(
      { id: "project-1", name: "Arcadia", repositoryPath: "/tmp/arcadia" },
      "/tmp/arcadia", "pmark/arcadia", {
        number: 42, title: "Brief", url: "https://github.com/pmark/arcadia/pull/42",
        state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", headRefName: "feature/brief",
        baseRefName: "main", reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: []
      }
    );
    expect(pullRequest).not.toBeNull();
    const briefing = buildPullRequestBriefing(pullRequest!, {
      body: "Updates docs/decisions/0038-authorize-real-session-dogfood.md",
      files: ["docs/decisions/0038-authorize-real-session-dogfood.md", "src/db/schema.ts", "src/new-file.ts"]
    }, new Map([["pmark/arcadia:main", { ...pullRequest!, number: 41, title: "Earlier", headBranch: "main" }]]));
    expect(briefing.decisionFiles).toEqual(["docs/decisions/0038-authorize-real-session-dogfood.md"]);
    expect(briefing.unmentionedFiles).toEqual(["src/db/schema.ts", "src/new-file.ts"]);
    expect(briefing.materialFacts.join(" ")).toMatch(/database schema|not named/i);
  });

  it("reads a commit StatusContext like CodeRabbit as complete once it has a settled state", () => {
    expect(normalizeCheck({ context: "CodeRabbit", state: "SUCCESS" })).toMatchObject({ name: "CodeRabbit", status: "COMPLETED", conclusion: "SUCCESS" });
    expect(normalizeCheck({ context: "CodeRabbit", state: "PENDING" })).toMatchObject({ status: "PENDING", conclusion: null });
    expect(normalizeCheck({ context: "CodeRabbit", state: "EXPECTED" })).toMatchObject({ status: "PENDING", conclusion: null });
    expect(normalizeCheck({ name: "lint", status: "COMPLETED", conclusion: "SUCCESS" })).toMatchObject({ name: "lint", status: "COMPLETED", conclusion: "SUCCESS" });
  });

  it("keeps the work monitor's projection of a captured rollup to name, status, conclusion and url", () => {
    expect(rollup("checkRunsWithCodeRabbitPending").map(normalizeCheck).slice(-2)).toEqual([
      { name: "e2e", status: "COMPLETED", conclusion: "SUCCESS", url: expect.stringMatching(/^https:\/\/github\.com\/pmark\/arcadia\/actions\/runs\//) },
      { name: "CodeRabbit", status: "PENDING", conclusion: null, url: null }
    ]);
  });
});

it("retains configured repositories when no PR is open", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-pr-registry-"));
  try {
    const snapshot = listOutstandingPullRequests([{ id: "project", name: "Project", repositoryPath: directory }], { runCommand: (_cwd, command, args) => ({ ok: true, stdout: command === "git" ? "true" : args[0] === "repo" ? "owner/repo" : "[]", stderr: "" }) });
    expect(snapshot.pullRequests).toEqual([]);
    expect(snapshot.repositories).toEqual([{ projectId: "project", projectName: "Project", repository: "owner/repo", repositoryPath: realpathSync(directory) }]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


describe("lightweight PR reads", () => {
  it("does one list and zero body/file/detail reads for multiple open PRs", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arcadia-light-pr-"));
    const calls: string[][] = [];
    try {
      const snapshot = listOutstandingPullRequests([{ id: "project", name: "Project", repositoryPath: directory }], {
        lightweight: true,
        runCommand: (_cwd, command, args) => {
          calls.push([command, ...args]);
          return { ok: true, stderr: "", stdout: command === "git" ? (args[0] === "remote" ? "git@github.com:owner/repo.git" : "true")
            : JSON.stringify([1, 2].map(number => ({ number, title: `PR ${number}`, url: `https://github.com/owner/repo/pull/${number}`, mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", statusCheckRollup: [] }))) };
        }
      });
      expect(snapshot.pullRequests).toHaveLength(2);
      expect(snapshot.pullRequests.every(pr => pr.briefing === null && pr.detailsLoaded === false && pr.readiness !== "merge_ready")).toBe(true);
      expect(calls.filter(call => call[0] === "gh")).toHaveLength(1);
      expect(calls.find(call => call[0] === "gh")?.slice(1, 3)).toEqual(["pr", "list"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("preserves rich default callers and their body/file briefing reads", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arcadia-rich-pr-"));
    const calls: string[][] = [];
    try {
      const snapshot = listOutstandingPullRequests([{ id: "project", name: "Project", repositoryPath: directory }], {
        runCommand: (_cwd, command, args) => {
          calls.push([command, ...args]);
          return { ok: true, stderr: "", stdout: command === "git" ? "true" : args[0] === "repo" ? "owner/repo"
            : args[1] === "view" ? JSON.stringify({ body: "Changes fix.ts", files: [{ path: "src/fix.ts" }] })
            : JSON.stringify([{ number: 1, title: "PR", url: "https://github.com/owner/repo/pull/1", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", statusCheckRollup: [] }]) };
        }
      });
      expect(snapshot.pullRequests[0].readiness).toBe("merge_ready");
      expect(snapshot.pullRequests[0].briefing?.changedFiles).toEqual(["src/fix.ts"]);
      expect(calls.filter(call => call[0] === "gh")).toHaveLength(3);
      expect(calls.some(call => call.includes("body,files"))).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each(["git@github.com:owner/repo.git", "https://github.com/owner/repo.git", "ssh://git@github.com/owner/repo.git"])("resolves configured %s without any remote GitHub call", origin => {
    const directory = mkdtempSync(path.join(tmpdir(), "arcadia-local-pr-"));
    const calls: string[] = [];
    try {
      const snapshot = listOutstandingPullRequests([{ id: "project", name: "Project", repositoryPath: directory }], { repositoriesOnly: true,
        runCommand: (_cwd, command, args) => { calls.push(command); return { ok: true, stdout: args[0] === "remote" ? origin : "true", stderr: "" }; }
      });
      expect(snapshot.repositories?.[0]?.repository).toBe("owner/repo");
      expect(snapshot.pullRequests).toEqual([]);
      expect(calls).not.toContain("gh");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("refuses a configured directory that is not a Git repository without a GitHub query", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "arcadia-local-pr-"));
    const calls: string[] = [];
    try {
      const snapshot = listOutstandingPullRequests([{ id: "project", name: "Project", repositoryPath: directory }], { repositoriesOnly: true,
        runCommand: (_cwd, command) => { calls.push(command); return { ok: false, stdout: "", stderr: "not Git" }; }
      });
      expect(snapshot.repositories).toEqual([]);
      expect(snapshot.errors).toHaveLength(1);
      expect(calls).toEqual(["git"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each(["https://evilgithub.com/owner/repo", "git@other.test:owner/repo.git", "https://github.com/owner", "not-a-remote"])("refuses untrusted or unsupported origin %s", origin => {
    const directory = mkdtempSync(path.join(tmpdir(), "arcadia-local-pr-"));
    try {
      const snapshot = listOutstandingPullRequests([{ id: "project", name: "Project", repositoryPath: directory }], { repositoriesOnly: true,
        runCommand: (_cwd, _command, args) => ({ ok: true, stdout: args[0] === "remote" ? origin : "true", stderr: "" })
      });
      expect(snapshot.repositories).toEqual([]);
      expect(snapshot.errors).toHaveLength(1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
