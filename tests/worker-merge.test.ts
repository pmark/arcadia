import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBatchMergeCard, type BatchPrFacts } from "../src/decisions/batchMerge.js";
import {
  evaluateWorkerMerge,
  listWorkerMerges,
  mergeCandidatePullRequest,
  operatorMergeQueue,
  withWorkerMergeReasons,
  type WorkerMergeBlastRadius,
  type WorkerMergeFacts,
  type WorkerMergeRefusalCode
} from "../src/production/workerMerge.js";
import { fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { describeWorkerPullRequestMerge } from "../src/commands/production.js";
import type { VerdictGate } from "../src/sessions/roleLineage.js";
import { FakeGitHub, git } from "./helpers/rehearsalHarness.js";

/**
 * The worker's automated review-and-merge gate (Decision 0097, Action
 * worker-review-and-merge), hermetic: a real local repository and bare
 * `origin`, the shared FakeGitHub for every `gh` call, an in-memory database.
 * No network, no live workspace, no real GitHub.
 */

const HEAD = "a".repeat(40);
const URL = "https://github.com/pmark/rehearsal/pull/7";
const GREEN = [{ name: "fast", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/fast", workflowName: "CI" }];

function gateFor(head: string): VerdictGate {
  return { satisfied: true, binding: { targetHead: head } , verdicts: {} } as unknown as VerdictGate;
}
const NARROW: WorkerMergeBlastRadius = { authorityAdjacent: false, reasons: [], boundaries: [], touchedPaths: ["feature.txt"], linesChanged: 1 };

function facts(over: Partial<WorkerMergeFacts> = {}): WorkerMergeFacts {
  return {
    expectedHead: HEAD,
    review: gateFor(HEAD),
    pullRequestUrl: URL,
    pullRequest: { state: "OPEN", isDraft: false, headRefName: "claude/x", headRefOid: HEAD, mergeStateStatus: "CLEAN", statusCheckRollup: GREEN },
    blastRadius: NARROW,
    ...over
  };
}
const codeOf = (f: WorkerMergeFacts): WorkerMergeRefusalCode | "ok" => {
  const result = evaluateWorkerMerge(f);
  return result.ok ? "ok" : result.code;
};

describe("evaluateWorkerMerge: the pure gate, fail closed", () => {
  it("passes only an exact-head reviewed, green, CLEAN, non-adjacent PR", () => {
    expect(codeOf(facts())).toBe("ok");
  });
  it("refuses a missing review", () => {
    expect(codeOf(facts({ review: null }))).toBe("review_missing");
    expect(codeOf(facts({ review: { satisfied: false, code: "awaiting_independent_verdicts", reason: "qa: none", head: HEAD, missing: ["qa: none"] } }))).toBe("review_missing");
  });
  it("refuses a review of another head", () => {
    expect(codeOf(facts({ review: gateFor("b".repeat(40)) }))).toBe("review_stale_head");
  });
  it("refuses a moved PR head", () => {
    expect(codeOf(facts({ pullRequest: { ...facts().pullRequest!, headRefOid: "c".repeat(40) } }))).toBe("head_moved");
  });
  it("refuses failed, pending and unknown checks", () => {
    const pr = facts().pullRequest!;
    expect(codeOf(facts({ pullRequest: { ...pr, statusCheckRollup: [{ ...GREEN[0], conclusion: "FAILURE" }] } }))).toBe("check_failed");
    expect(codeOf(facts({ pullRequest: { ...pr, statusCheckRollup: [{ ...GREEN[0], status: "IN_PROGRESS", conclusion: "" }] } }))).toBe("checks_pending");
    expect(codeOf(facts({ pullRequest: { ...pr, statusCheckRollup: [] } }))).toBe("checks_unknown");
    expect(codeOf(facts({ pullRequest: { ...pr, statusCheckRollup: undefined as never } }))).toBe("checks_unknown");
  });
  it("refuses a merge state other than CLEAN, including unknown", () => {
    const pr = facts().pullRequest!;
    for (const state of ["BLOCKED", "UNSTABLE", "BEHIND", "DIRTY", "UNKNOWN", null]) {
      expect(codeOf(facts({ pullRequest: { ...pr, mergeStateStatus: state } }))).toBe("merge_state_not_clean");
    }
  });
  it("refuses an unknown or authority-adjacent blast radius", () => {
    expect(codeOf(facts({ blastRadius: null }))).toBe("blast_radius_unknown");
    expect(codeOf(facts({ blastRadius: { ...NARROW, authorityAdjacent: true, reasons: ["Touches src/production/x.ts."] } }))).toBe("authority_adjacent");
  });
  it("refuses a missing, unreadable, closed or draft PR", () => {
    expect(codeOf(facts({ pullRequestUrl: null }))).toBe("pull_request_missing");
    expect(codeOf(facts({ pullRequest: null }))).toBe("pull_request_unreadable");
    expect(codeOf(facts({ pullRequest: { ...facts().pullRequest!, state: "CLOSED" } }))).toBe("pull_request_not_open");
    expect(codeOf(facts({ pullRequest: { ...facts().pullRequest!, isDraft: true } }))).toBe("pull_request_not_open");
  });
});

describe("mergeCandidatePullRequest against a real repository and the shared FakeGitHub", () => {
  let root: string;
  let repo: string;
  let github: FakeGitHub;
  let db: Database.Database;
  let head: string;
  const branch = "claude/write-feature-20261017T000000000Z";

  /** A candidate: the agent's commit (`files`), then a governed settlement commit writing PROJECT.md. */
  function candidate(files: Record<string, string>): void {
    git(repo, ["checkout", "-q", "-b", branch]);
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), content);
    }
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "agent work"]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["commit", "-q", "-am", "settle completion"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
  }

  function merge(over: { review?: VerdictGate | null; syncFails?: boolean } = {}) {
    return mergeCandidatePullRequest({
      db, repoRoot: repo, baseBranch: "main", sessionId: "session_1", actionKey: "fixture/write-feature", head,
      settlementCommit: head, pullRequestUrl: URL, review: over.review === undefined ? gateFor(head) : over.review,
      now: new Date("2026-10-17T12:00:00Z")
    }, {
      runCommand: github.runCommand,
      ...(over.syncFails ? { syncBase: () => { throw new Error("fetch refused"); } } : {})
    });
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "worker-merge-")));
    repo = path.join(root, "repo");
    const origin = path.join(root, "origin.git");
    git(root, ["init", "-q", "--bare", "-b", "main", origin]);
    mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.name", "Fixture"]);
    git(repo, ["config", "user.email", "fixture@example.invalid"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: write-feature\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "genesis"]);
    git(repo, ["remote", "add", "origin", origin]);
    git(repo, ["push", "-q", "origin", "main"]);
    github = new FakeGitHub(origin);
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("merges through GitHub with --match-head-commit and moves the local base onto GitHub's merge commit", () => {
    candidate({ "feature.txt": "feature\n" });
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "merged", head, pullRequestUrl: URL, replayed: false });
    expect(github.ghCalls).toContain(`gh pr merge ${URL} --merge --match-head-commit ${head}`);
    expect(github.mergeCalls).toEqual([{ url: URL, matchHead: head, merged: true }]);
    const localMain = git(repo, ["rev-parse", "refs/heads/main"]).trim();
    expect(localMain).toBe(github.headOf("main"));
    expect(localMain).not.toBe(head);
    expect(git(repo, ["rev-parse", `${localMain}^2`]).trim()).toBe(head);
    expect(listWorkerMerges(db).map((row) => row.outcome)).toEqual(["merged"]);
    // A replay (the PR already MERGED at this head) only re-syncs.
    expect(merge()).toMatchObject({ kind: "merged", replayed: true });
    expect(github.mergeCalls).toHaveLength(1);
  });

  it("refuses a moved head by name, and never calls merge", () => {
    candidate({ "feature.txt": "feature\n" });
    git(repo, ["checkout", "-q", branch]);
    writeFileSync(path.join(repo, "feature.txt"), "moved\n");
    git(repo, ["commit", "-q", "-am", "unreviewed push"]);
    git(repo, ["push", "-q", "origin", branch]);
    git(repo, ["checkout", "-q", "main"]);
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "head_moved" });
    expect(github.mergeCalls).toEqual([]);
    expect(github.ghCalls.some((call) => call.startsWith("gh pr merge"))).toBe(false);
  });

  it("refuses when GitHub's own --match-head-commit check sees the head move after the read", () => {
    candidate({ "feature.txt": "feature\n" });
    github.beforeMerge = () => {
      git(repo, ["checkout", "-q", branch]);
      writeFileSync(path.join(repo, "feature.txt"), "raced\n");
      git(repo, ["commit", "-q", "-am", "race"]);
      git(repo, ["push", "-q", "origin", branch]);
      git(repo, ["checkout", "-q", "main"]);
    };
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "merge_failed" });
    expect(github.mergeCalls).toEqual([{ url: URL, matchHead: head, merged: false }]);
    expect(github.headOf("main")).toBe(git(repo, ["rev-parse", "refs/heads/main"]).trim());
  });

  it("refuses a failed check by name", () => {
    candidate({ "feature.txt": "feature\n" });
    github.checks = () => [{ ...GREEN[0], conclusion: "FAILURE" }];
    expect(merge()).toMatchObject({ kind: "refused", code: "check_failed" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("refuses unknown check state and a non-CLEAN merge state", () => {
    candidate({ "feature.txt": "feature\n" });
    github.checks = () => [];
    expect(merge()).toMatchObject({ kind: "refused", code: "checks_unknown" });
    github.checks = () => GREEN;
    github.mergeState = () => "BLOCKED";
    expect(merge()).toMatchObject({ kind: "refused", code: "merge_state_not_clean" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("refuses a missing review by name", () => {
    candidate({ "feature.txt": "feature\n" });
    expect(merge({ review: null })).toMatchObject({ kind: "refused", code: "review_missing" });
    expect(merge({ review: gateFor("d".repeat(40)) })).toMatchObject({ kind: "refused", code: "review_stale_head" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("never merges an authority-adjacent PR and puts it on the batch-merge card with its reason", () => {
    candidate({ "src/production/policy.ts": "export const widened = true;\n" });
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(outcome.kind === "refused" && outcome.reason).toMatch(/src\/production\/policy\.ts/);
    expect(github.mergeCalls).toEqual([]);

    const queue = operatorMergeQueue(db);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ pullRequestUrl: URL, pullRequestNumber: 7, headSha: head, boundaries: ["production_policy"] });

    const facts: BatchPrFacts = {
      number: 7, title: "Candidate", headSha: head, baseRef: "main", headRef: branch, files: ["src/production/policy.ts", "PROJECT.md"], changedFiles: 2,
      why: "", decisions: ["0097"], reviews: [{ verdict: "APPROVED", headSha: head }], checks: [{ name: "fast", conclusion: "SUCCESS" }], requiredChecks: ["fast"]
    };
    const built = buildBatchMergeCard({
      prs: withWorkerMergeReasons([facts], queue),
      now: new Date("2026-10-17T12:00:00Z"),
      expires: "2026-10-18T12:00:00Z",
      acknowledgedBoundaries: { 7: ["production_policy", "project_governance"] }
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.items[0].why).toMatch(/The worker did not merge fixture\/write-feature \(authority_adjacent\)/);
    expect(built.items[0].why).toMatch(/src\/production\/policy\.ts/);
  });

  it("treats paths outside the governed records in the settlement commit as authority-adjacent", () => {
    git(repo, ["checkout", "-q", "-b", branch]);
    writeFileSync(path.join(repo, "feature.txt"), "feature\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "agent work"]);
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "# Rewritten\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "settle completion"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
    expect(merge()).toMatchObject({ kind: "refused", code: "authority_adjacent" });
  });

  it("reports a merged PR whose local base could not be synced, without an operator merge command", () => {
    candidate({ "feature.txt": "feature\n" });
    const outcome = merge({ syncFails: true });
    expect(outcome).toMatchObject({ kind: "refused", code: "base_not_synced", operatorMergeCommand: null });
    expect(github.mergeCalls).toEqual([{ url: URL, matchHead: head, merged: true }]);
  });
});

describe("the worker-merge opt-in in the production scope", () => {
  const base = {
    intent: "Fixture.", projects: ["p"], plans: ["p/plan"], actions: ["p/a"], providers: ["claude-code-cli"],
    maxConcurrentSessions: 1, mechanicalTransitions: ["validation", "acceptance", "pointer"] as never, remotePreservation: true,
    integrationGrant: { decisionRef: "0058", expiresAt: "2026-10-18T00:00:00.000Z", actions: [] }
  };
  it("defaults off and leaves an existing scope's fingerprint unchanged", () => {
    const off = normalizeProductionScope(base);
    expect(off.integrationGrant?.mergeThroughPullRequest).toBeUndefined();
    const explicitOff = normalizeProductionScope({ ...base, integrationGrant: { ...base.integrationGrant, mergeThroughPullRequest: false } });
    expect(fingerprintProductionScope(explicitOff)).toBe(fingerprintProductionScope(off));
    expect(describeWorkerPullRequestMerge(off.integrationGrant)).toMatch(/^off/);
  });
  it("is part of the reviewed fingerprint when on, and shown", () => {
    const on = normalizeProductionScope({ ...base, integrationGrant: { ...base.integrationGrant, mergeThroughPullRequest: true } });
    expect(on.integrationGrant?.mergeThroughPullRequest).toBe(true);
    expect(fingerprintProductionScope(on)).not.toBe(fingerprintProductionScope(normalizeProductionScope(base)));
    expect(describeWorkerPullRequestMerge(on.integrationGrant)).toMatch(/^ON/);
  });
  it("is refused without remote preservation", () => {
    expect(() => normalizeProductionScope({ ...base, remotePreservation: false, integrationGrant: { ...base.integrationGrant, mergeThroughPullRequest: true } }))
      .toThrow(/remote-preservation/);
  });
});
