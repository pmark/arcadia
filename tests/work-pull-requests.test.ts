import { describe, expect, it } from "vitest";
import {
  derivePullRequestReadiness,
  normalizePullRequest
} from "../src/workMonitoring/pullRequests.js";

describe("outstanding pull-request readiness", () => {
  it("rates an approved clean PR as merge-ready", () => {
    expect(derivePullRequestReadiness({
      isDraft: false,
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      checks: [{ name: "CI", status: "COMPLETED", conclusion: "SUCCESS", url: null }]
    })).toBe("merge_ready");
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
});

