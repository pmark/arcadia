import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decisionIdClashRefusal, systemDecisionGit } from "../src/decisions/decisionIds.js";
import { buildBatchMergeCard, classifyAuthorityPaths, type BatchPrFacts } from "../src/decisions/batchMerge.js";
import {
  evaluateWorkerMerge,
  isWorkerMergeSafePath,
  listWorkerMerges,
  mergeCandidatePullRequest,
  operatorMergeQueue,
  withWorkerMergeReasons,
  type WorkerMergeBlastRadius,
  type WorkerMergeFacts,
  type WorkerMergeRefusalCode
} from "../src/production/workerMerge.js";
import { ensureProductionPolicyTables, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { stringify as stringifyYaml } from "yaml";
import { DELEGATION_SCOPE } from "../src/operatorActions/startRunDelegation.js";
import type { GateSetDocument } from "../src/production/gateSet.js";
import { evaluateStandingMerge, findAuthorizingDecision, planActionHash, type StandingMergeDeps, type StandingMergeInput } from "../src/production/standingMerge.js";
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
/** A plain report document: on the worker-merge allowlist. */
const SAFE = "docs/reports/feature.md";
const NARROW: WorkerMergeBlastRadius = { authorityAdjacent: false, reasons: [], boundaries: [], touchedPaths: [SAFE], linesChanged: 1 };

function facts(over: Partial<WorkerMergeFacts> = {}): WorkerMergeFacts {
  return {
    expectedHead: HEAD,
    baseBranch: "main",
    review: gateFor(HEAD),
    pullRequestUrl: URL,
    pullRequest: { state: "OPEN", isDraft: false, headRefName: "claude/x", baseRefName: "main", headRefOid: HEAD, mergeStateStatus: "CLEAN", statusCheckRollup: GREEN },
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
  it("refuses a PR that does not target the governed base", () => {
    expect(codeOf(facts({ pullRequest: { ...facts().pullRequest!, baseRefName: "claude/previous" } }))).toBe("wrong_base");
    expect(codeOf(facts({ pullRequest: { ...facts().pullRequest!, baseRefName: undefined } }))).toBe("wrong_base");
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

  function merge(over: { review?: VerdictGate | null; syncFails?: boolean; mergeFreeze?: () => { message: string } | null; decisionIdClash?: (input: { repoRoot: string; baseBranch: string; head: string }) => string | null } = {}) {
    return mergeCandidatePullRequest({
      db, repoRoot: repo, baseBranch: "main", sessionId: "session_1", actionKey: "fixture/write-feature", head,
      settlementCommit: head, pullRequestUrl: URL, review: over.review === undefined ? gateFor(head) : over.review,
      now: new Date("2026-10-17T12:00:00Z")
    }, {
      runCommand: github.runCommand,
      ...(over.mergeFreeze ? { mergeFreeze: over.mergeFreeze } : {}),
      ...(over.decisionIdClash ? { decisionIdClash: over.decisionIdClash } : {}),
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
    candidate({ [SAFE]: "feature\n" });
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

  it("refuses with the merge freeze message while a START card is pinned, and never calls merge", () => {
    candidate({ [SAFE]: "feature\n" });
    const outcome = merge({ mergeFreeze: () => ({ message: "merge freeze: card start-run-x pinned to aaaaaaaaaaaa." }) });
    expect(outcome).toMatchObject({ kind: "refused", code: "merge_freeze" });
    expect((outcome as { reason: string }).reason).toContain("merge freeze: card start-run-x pinned to aaaaaaaaaaaa");
    expect(github.ghCalls.some((call) => call.startsWith("gh pr merge"))).toBe(false);
    expect(listWorkerMerges(db).map((row) => row.code)).toEqual(["merge_freeze"]);
    // Once the freeze lifts (the card pressed), the same merge goes through.
    expect(merge({ mergeFreeze: () => null })).toMatchObject({ kind: "merged" });
  });

  it("refuses a candidate whose Decision id origin main took meanwhile (checked against current origin main, names both files) and calls no merge", () => {
    // The worker allowlist keeps a Decision file out of an unattended candidate, so the real check is run against the
    // real repository here and its refusal is carried through the worker merge's duplicate-id seam.
    candidate({ [SAFE]: "feature\n" });
    // Another writer lands id 0300 on origin main after the candidate branched and was reviewed.
    git(repo, ["checkout", "-q", "main"]);
    mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
    writeFileSync(path.join(repo, "docs/decisions/0300-minted-on-main.md"), "main\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "mint 0300 on main"]);
    git(repo, ["push", "-q", "origin", "main"]);
    const real = (input: { repoRoot: string; baseBranch: string; head: string }) =>
      decisionIdClashRefusal(systemDecisionGit(input.repoRoot), input.head, input.baseBranch);
    // The settlement-free candidate head plus a Decision file at id 0300, as a branch the allowlist would never merge.
    git(repo, ["checkout", "-q", "-b", "probe", head]);
    mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
    writeFileSync(path.join(repo, "docs/decisions/0300-from-candidate.md"), "candidate\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "decision 0300 on the candidate"]);
    const probeHead = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    const refusal = real({ repoRoot: repo, baseBranch: "main", head: probeHead });
    expect(refusal).toContain("docs/decisions/0300-from-candidate.md");
    expect(refusal).toContain("docs/decisions/0300-minted-on-main.md");
    const outcome = merge({ decisionIdClash: () => refusal });
    expect(outcome).toMatchObject({ kind: "refused", code: "decision_id_duplicate" });
    expect((outcome as { reason: string }).reason).toContain("docs/decisions/0300-minted-on-main.md");
    expect(github.ghCalls.some((call) => call.startsWith("gh pr merge"))).toBe(false);
  });

  it("default gate: a pinned unpressed per-run START card refuses with the exact freeze message, keeps the card and calls no merge; pressing it lets the merge through", () => {
    candidate({ [SAFE]: "feature\n" });
    const library = path.join(root, "library");
    mkdirSync(library);
    const originMain = git(repo, ["rev-parse", "refs/remotes/origin/main"]).trim();
    const cardFile = path.join(library, "start-run-pinned.json");
    writeFileSync(cardFile, JSON.stringify({
      schema: "arcadia-operator-script-v1",
      id: "start-run-pinned",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      startRun: { schema: "arcadia-start-run-v1", reviewedRevision: originMain }
    }));
    const previous = process.env.ARCADIA_OPERATOR_SCRIPT_LIBRARY;
    process.env.ARCADIA_OPERATOR_SCRIPT_LIBRARY = library;
    try {
      // No mergeFreeze is injected: workerMergeFreeze(db, repoRoot) runs for real.
      const outcome = merge();
      expect(outcome).toMatchObject({ kind: "refused", code: "merge_freeze" });
      expect((outcome as { reason: string }).reason).toContain(`merge freeze: card start-run-pinned pinned to ${originMain.slice(0, 12)}`);
      expect(github.ghCalls.some((call) => call.startsWith("gh pr merge"))).toBe(false);
      expect(github.mergeCalls).toEqual([]);
      expect(existsSync(cardFile)).toBe(true);
      expect(listWorkerMerges(db).map((row) => row.code)).toEqual(["merge_freeze"]);

      // Pressed (consumed): the card no longer waits, so the same call reaches the merge step.
      writeFileSync(path.join(library, "start-run-pinned.consumed.json"), JSON.stringify({ state: "CONSUMED" }));
      expect(merge()).toMatchObject({ kind: "merged" });
      expect(github.mergeCalls).toEqual([{ url: URL, matchHead: head, merged: true }]);
      expect(existsSync(cardFile)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ARCADIA_OPERATOR_SCRIPT_LIBRARY;
      else process.env.ARCADIA_OPERATOR_SCRIPT_LIBRARY = previous;
    }
  });

  it("refuses a moved head by name, and never calls merge", () => {
    candidate({ [SAFE]: "feature\n" });
    git(repo, ["checkout", "-q", branch]);
    writeFileSync(path.join(repo, SAFE), "moved\n");
    git(repo, ["commit", "-q", "-am", "unreviewed push"]);
    git(repo, ["push", "-q", "origin", branch]);
    git(repo, ["checkout", "-q", "main"]);
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "head_moved" });
    expect(github.mergeCalls).toEqual([]);
    expect(github.ghCalls.some((call) => call.startsWith("gh pr merge"))).toBe(false);
  });

  it("refuses when GitHub's own --match-head-commit check sees the head move after the read", () => {
    candidate({ [SAFE]: "feature\n" });
    github.beforeMerge = () => {
      git(repo, ["checkout", "-q", branch]);
      writeFileSync(path.join(repo, SAFE), "raced\n");
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
    candidate({ [SAFE]: "feature\n" });
    github.checks = () => [{ ...GREEN[0], conclusion: "FAILURE" }];
    expect(merge()).toMatchObject({ kind: "refused", code: "check_failed" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("refuses unknown check state and a non-CLEAN merge state", () => {
    candidate({ [SAFE]: "feature\n" });
    github.checks = () => [];
    expect(merge()).toMatchObject({ kind: "refused", code: "checks_unknown" });
    github.checks = () => GREEN;
    github.mergeState = () => "BLOCKED";
    expect(merge()).toMatchObject({ kind: "refused", code: "merge_state_not_clean" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("refuses a missing review by name", () => {
    candidate({ [SAFE]: "feature\n" });
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
    mkdirSync(path.dirname(path.join(repo, SAFE)), { recursive: true });
    writeFileSync(path.join(repo, SAFE), "feature\n");
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

  // Review finding B1: every path that defines or enforces a gate (merge, review,
  // blast radius, checks, capacity/spend, CLI grant flags, identity, harness fakes)
  // is off the allowlist, so the worker can never merge a weakening of its own gate.
  it.each([
    "src/stewardship/prBlastRadius.ts",
    "src/qa/prReview.ts",
    "src/review/gate.ts",
    "src/agentRoles/registry.ts",
    "src/codingAgents/capacity.ts",
    "src/workspace/experimentGuard.ts",
    "src/cli.ts",
    "src/commands/production.ts",
    "src/decisions/batchMerge.ts",
    "src/identity/resolve.ts",
    "tests/helpers/rehearsalHarness.ts",
    "tests/fast-rehearsal/helpers/github.ts",
    "apps/dashboard/app/api/production-control/route.ts",
    "apps/dashboard/app/todo/route.tsx",
    "apps/dashboard/lib/decision-cards-server.ts",
    "apps/dashboard/middleware.ts",
    "docs/decisions/0200-widen-merge.md",
    "docs/agent-guidance/pull-requests.md",
    "docs/plans/next.md",
    "scripts/merge-decision-card-batch.ts",
    ".github/workflows/ci.yml",
    "package.json",
    "AGENTS.md",
    "feature.txt",
    // Review round 2, B2: no dashboard file is allowlisted (server components can run commands).
    "apps/dashboard/components/Feature.tsx",
    "apps/dashboard/app/todo/page.tsx",
    "apps/dashboard/app/globals.css",
    // B3: case variants of excluded and governance paths, on a case-insensitive host.
    "docs/Decisions/0200-x.md",
    "Docs/agent-guidance/pull-requests.md",
    "docs/PLANS/next.md",
    "agents.md",
    "Constitution.md",
    "docs/reports/AGENTS.md",
    "Tests/helpers/rehearsalHarness.ts",
    "docs/.hidden/x.md",
    // Round 3 hardening: procedure documents, the hot cache, entry documents and test fixtures/setup.
    "docs/notes-to-self.md",
    "docs/working-copy-safety.md",
    "docs/planning-process.md",
    "docs/managed-documents.md",
    "START_HERE.md",
    "INSTALL_WITH_A_CODING_AGENT.md",
    "tests/e2e/global-setup.ts",
    "tests/e2e/fixtures/workspace.json",
    "tests/fixtures/plan.md"
  ])("refuses %s as authority_adjacent and never calls merge", (file) => {
    candidate({ [file]: "changed\n" });
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(outcome.kind === "refused" && outcome.reason).toContain(file);
    expect(github.mergeCalls).toEqual([]);
  });

  it.each([SAFE, "tests/marker.test.mjs", "docs/reports/note.md", "README.md"])(
    "still merges an allowlisted change: %s",
    (file) => {
      candidate({ [file]: "changed\n" });
      expect(merge()).toMatchObject({ kind: "merged" });
    }
  );

  // Decision 0214 A: an unclassified src/** change merges on the same proof gates.
  describe("an unclassified src change (Decision 0214 A)", () => {
    const UNCLASSIFIED = "src/digests/report.ts";
    it("merges an unclassified src path, and still refuses a classified src path as authority_adjacent", () => {
      candidate({ [UNCLASSIFIED]: "export const x = 1;\n" });
      expect(merge()).toMatchObject({ kind: "merged" });
      expect(github.mergeCalls).toHaveLength(1);
    });
    it("refuses a classified src path in the same candidate as an unclassified one", () => {
      candidate({ [UNCLASSIFIED]: "x\n", "src/production/workerMerge.ts": "y\n" });
      expect(merge()).toMatchObject({ kind: "refused", code: "authority_adjacent" });
      expect(github.mergeCalls).toEqual([]);
    });
    it("still refuses without an exact-head review", () => {
      candidate({ [UNCLASSIFIED]: "x\n" });
      expect(merge({ review: null })).toMatchObject({ kind: "refused", code: "review_missing" });
      expect(merge({ review: gateFor("d".repeat(40)) })).toMatchObject({ kind: "refused", code: "review_stale_head" });
      expect(github.mergeCalls).toEqual([]);
    });
    it("still refuses a failed check, unknown checks and a non-CLEAN merge state", () => {
      candidate({ [UNCLASSIFIED]: "x\n" });
      github.checks = () => [{ ...GREEN[0], conclusion: "FAILURE" }];
      expect(merge()).toMatchObject({ kind: "refused", code: "check_failed" });
      github.checks = () => [];
      expect(merge()).toMatchObject({ kind: "refused", code: "checks_unknown" });
      github.checks = () => GREEN;
      github.mergeState = () => "BLOCKED";
      expect(merge()).toMatchObject({ kind: "refused", code: "merge_state_not_clean" });
      expect(github.mergeCalls).toEqual([]);
    });
    it("still withholds the merge when the mergeThroughPullRequest grant is withdrawn", () => {
      candidate({ [UNCLASSIFIED]: "x\n" });
      const outcome = mergeCandidatePullRequest({
        db, repoRoot: repo, baseBranch: "main", sessionId: "session_1", actionKey: "fixture/write-feature", head,
        settlementCommit: head, pullRequestUrl: URL, review: gateFor(head), now: new Date("2026-10-17T12:00:00Z"),
        authorityChanged: () => "the worker pull-request merge opt-in was withdrawn"
      }, { runCommand: github.runCommand });
      expect(outcome.kind).toBe("withheld");
      expect(github.mergeCalls).toEqual([]);
    });
  });

  // Review round 2, B1: a rename counts as both its old and new path.
  it.each([
    ["CONSTITUTION.md", "docs/old-constitution.md"],
    ["docs/decisions/0001-merge-gate.md", "docs/reports/0001-merge-gate.md"],
    [".github/workflows/ci.yml", "tests/ci.yml"]
  ])("refuses renaming %s to %s as authority_adjacent", (from, to) => {
    mkdirSync(path.dirname(path.join(repo, from)), { recursive: true });
    writeFileSync(path.join(repo, from), "governed\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "governed file"]);
    git(repo, ["push", "-q", "origin", "main"]);
    git(repo, ["checkout", "-q", "-b", branch]);
    mkdirSync(path.dirname(path.join(repo, to)), { recursive: true });
    git(repo, ["mv", from, to]);
    git(repo, ["commit", "-q", "-m", "move it"]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["commit", "-q", "-am", "settle completion"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(outcome.kind === "refused" && outcome.reason).toContain(from);
    expect(github.mergeCalls).toEqual([]);
  });

  it("refuses a PR that targets another base (N1)", () => {
    git(repo, ["push", "-q", "origin", "main:refs/heads/claude/previous"]);
    candidate({ [SAFE]: "feature\n" });
    github.prs[0].baseBranch = "claude/previous";
    expect(merge()).toMatchObject({ kind: "refused", code: "wrong_base" });
    expect(github.mergeCalls).toEqual([]);
  });

  /**
   * The live shape of every headless Claude candidate (PR #1545, 2026-10-18): the
   * sandboxed agent cannot commit, so host preservation commits its work AND its
   * drafted `complete` Ask in one commit, and the worker's settlement commit then
   * renames that draft into `.arcadia/asks/archive/`. The draft never reaches the
   * base: at the head only the archived Ask (a settlement record) remains.
   */
  const DRAFT = ".arcadia/asks/agent-ask-complete-write-feature-0123456789ab.yaml";
  const ASK = `${JSON.stringify({ agent_ask: "v1", request_id: "complete-write-feature-0123456789ab", project: "fixture", intent: "complete", target_ref: "action/write-feature", candidate_revision: "0".repeat(40), evidence: [{ criterion: "The feature report exists.", status: "met", note: "Wrote docs/reports/feature.md and read it back." }], desired_result: "Mark write-feature complete." })}\n`;
  function draftOnlyCandidate(input: { archive?: string | null; extraDraft?: string } = {}): void {
    git(repo, ["checkout", "-q", "-b", branch]);
    mkdirSync(path.join(repo, "docs/reports"), { recursive: true });
    mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
    writeFileSync(path.join(repo, SAFE), "feature\n");
    writeFileSync(path.join(repo, DRAFT), ASK);
    if (input.extraDraft) writeFileSync(path.join(repo, input.extraDraft), ASK.replace("0123456789ab", "ffffffffffff"));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "chore(candidate): preserve write-feature candidate for handoff"]);
    const archive = input.archive === undefined ? `.arcadia/asks/archive/${path.basename(DRAFT)}` : input.archive;
    if (archive) git(repo, ["mv", DRAFT, archive]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "chore(arcadia): settle auto-settle-fixture-write-feature"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
  }

  it("merges a draft-only candidate whose own completion draft its settlement archives (the headless Claude shape)", () => {
    draftOnlyCandidate();
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "merged", head });
    expect(github.mergeCalls).toEqual([{ url: URL, matchHead: head, merged: true }]);
  });

  /**
   * Live repair PR #1554 (2026-10-19): a review repair of a candidate that had
   * drafted its own completion. The failed candidate's draft is preserved, then
   * retired by the controller; the repair's own draft is pretty-printed JSON,
   * which the settlement re-serializes compactly with the revision it bound, so
   * git shows a deletion plus a new archive rather than a rename.
   */
  function repairWithSplitArchive(archive: (ask: Record<string, unknown>) => Record<string, unknown>): void {
    git(repo, ["checkout", "-q", "-b", branch]);
    mkdirSync(path.join(repo, "docs/reports"), { recursive: true });
    mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
    const failedDraft = ".arcadia/asks/agent-ask-complete-write-feature-aaaaaaaaaaaa.yaml";
    writeFileSync(path.join(repo, SAFE), "feature\n");
    writeFileSync(path.join(repo, failedDraft), ASK.replace("0123456789ab", "aaaaaaaaaaaa"));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "chore(candidate): preserve write-feature candidate for handoff"]);
    git(repo, ["rm", "-q", failedDraft]);
    git(repo, ["-c", "user.name=Arcadia Controller", "-c", "user.email=controller@arcadia.local", "commit", "-q", "-m",
      "chore(arcadia): retire the failed candidate's completion draft for write-feature\n\nArcadia-Retired-Completion-Draft: complete-write-feature-aaaaaaaaaaaa"]);
    const ask = JSON.parse(ASK) as Record<string, unknown>;
    writeFileSync(path.join(repo, SAFE), "feature, repaired\n");
    writeFileSync(path.join(repo, DRAFT), `${JSON.stringify(ask, null, 2)}\n`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "chore(candidate): preserve write-feature candidate for handoff"]);
    git(repo, ["rm", "-q", DRAFT]);
    writeFileSync(path.join(repo, `.arcadia/asks/archive/${path.basename(DRAFT)}`), `${JSON.stringify(archive({ ...ask, candidate_revision: "1".repeat(40) }))}\n`);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "chore(arcadia): settle auto-settle-fixture-write-feature"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
  }

  it("merges a repair whose settlement archives its own pretty-printed draft compactly (a deletion plus a new archive, PR #1554)", () => {
    repairWithSplitArchive((ask) => ask);
    expect(merge()).toMatchObject({ kind: "merged", head });
    expect(github.mergeCalls).toEqual([{ url: URL, matchHead: head, merged: true }]);
  });

  it("still refuses a deleted draft whose new archive is not the same Ask apart from candidate_revision", () => {
    repairWithSplitArchive((ask) => ({ ...ask, desired_result: "Mark something else complete." }));
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(outcome.kind === "refused" && outcome.reason).toContain(path.basename(DRAFT));
    expect(github.mergeCalls).toEqual([]);
  });

  it("still refuses a draft the settlement leaves in place, archives under another name, or one it did not consume", () => {
    draftOnlyCandidate({ archive: null });
    expect(merge()).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("still refuses a second Agent Ask file the settlement did not archive", () => {
    draftOnlyCandidate({ extraDraft: ".arcadia/asks/agent-ask-complete-other-ffffffffffff.yaml" });
    const outcome = merge();
    expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(outcome.kind === "refused" && outcome.reason).toContain("agent-ask-complete-other-ffffffffffff.yaml");
    expect(outcome.kind === "refused" && outcome.reason).not.toContain(path.basename(DRAFT));
    expect(github.mergeCalls).toEqual([]);
  });

  it("still refuses a settlement that archives a draft already on the base rather than the candidate's own", () => {
    mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
    writeFileSync(path.join(repo, DRAFT), ASK);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "a stale draft already on main"]);
    git(repo, ["push", "-q", "origin", "main"]);
    git(repo, ["checkout", "-q", "-b", branch]);
    mkdirSync(path.join(repo, "docs/reports"), { recursive: true });
    writeFileSync(path.join(repo, SAFE), "feature\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "agent work"]);
    git(repo, ["mv", DRAFT, `.arcadia/asks/archive/${path.basename(DRAFT)}`]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "settle completion"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
    expect(merge()).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("still refuses archiving a draft that was on the candidate's merge base, even after main later removed it", () => {
    mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
    writeFileSync(path.join(repo, DRAFT), ASK);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "a stale draft on main"]);
    git(repo, ["checkout", "-q", "-b", branch]);
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["rm", "-q", DRAFT]);
    git(repo, ["commit", "-q", "-m", "main removes the stale draft"]);
    git(repo, ["push", "-q", "origin", "main"]);
    git(repo, ["checkout", "-q", branch]);
    mkdirSync(path.join(repo, "docs/reports"), { recursive: true });
    writeFileSync(path.join(repo, SAFE), "feature\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "agent work"]);
    git(repo, ["mv", DRAFT, `.arcadia/asks/archive/${path.basename(DRAFT)}`]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "settle completion"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
    expect(merge()).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("only treats an agent-ask-*.yaml draft as a consumed completion draft", () => {
    git(repo, ["checkout", "-q", "-b", branch]);
    mkdirSync(path.join(repo, "docs/reports"), { recursive: true });
    mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
    writeFileSync(path.join(repo, SAFE), "feature\n");
    writeFileSync(path.join(repo, ".arcadia/asks/other.yaml"), ASK);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "agent work"]);
    git(repo, ["mv", ".arcadia/asks/other.yaml", ".arcadia/asks/archive/other.yaml"]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "settle completion"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
    expect(merge()).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(github.mergeCalls).toEqual([]);
  });

  it("reports a merged PR whose local base could not be synced, without an operator merge command", () => {
    candidate({ [SAFE]: "feature\n" });
    const outcome = merge({ syncFails: true });
    expect(outcome).toMatchObject({ kind: "refused", code: "base_not_synced", operatorMergeCommand: null });
    expect(github.mergeCalls).toEqual([{ url: URL, matchHead: head, merged: true }]);
  });
});

describe("the worker-merge allowlist and the agent-guidance index", () => {
  it("refuses every procedure target the index lists, so a new one cannot slip in", () => {
    const index = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "docs", "agent-guidance", "index.json"), "utf8")) as unknown;
    const targets = new Set<string>();
    JSON.stringify(index, (_key, value: unknown) => {
      if (typeof value === "string" && /^[\w./-]+\.[a-z]+(?:#.*)?$/i.test(value) && value.includes("/")) targets.add(value.split("#")[0]);
      return value;
    });
    expect(targets.size).toBeGreaterThan(10);
    for (const target of ["docs/working-copy-safety.md", "docs/planning-process.md", "docs/managed-documents.md"]) expect(targets).toContain(target);
    const allowed = [...targets].filter((target) => isWorkerMergeSafePath(target) || isWorkerMergeSafePath(target.toUpperCase()));
    expect(allowed).toEqual([]);
  });
  it("accepts an unclassified src path only and refuses classified or non-src ones (Decision 0214 A)", () => {
    expect(classifyAuthorityPaths(["src/digests/report.ts"])).toEqual([]);
    expect(isWorkerMergeSafePath("src/digests/report.ts")).toBe(true);
    for (const file of ["src/production/workerMerge.ts", "src/cli.ts", "src/decisions/batchMerge.ts", "SRC/Production/x.ts", "apps/dashboard/lib/x.ts", "scripts/x.ts", "src/.hidden/x.ts"]) {
      expect(isWorkerMergeSafePath(file)).toBe(false);
    }
  });
  it.each([
    "tests/helpers/x.ts",
    "tests/fast-rehearsal/helpers/x.ts",
    "tests/setup.ts",
    "tests/e2e/global-setup.ts",
    "tests/e2e/fixtures/x.json",
    "tests/fixtures/x.txt",
    "docs/decisions/0001-x.md",
    "docs/agent-guidance/x.md",
    "docs/plans/x.md",
    "docs/scout/x.md",
    "docs/agents-context.md",
    "docs/managed-production-readiness.md",
    "AGENTS.md",
    "src/cli.ts",
    "docs/guide.txt",
    "tests/.hidden/x.test.ts"
  ])("refuses the carved-out or non-allowlisted path %s", (file) => {
    expect(isWorkerMergeSafePath(file)).toBe(false);
  });
  it.each([
    "tests/worker-merge.test.ts",
    "docs/guide.md",
    "notes.md",
    "src/digests/report.ts",
    "src/feature/plain.ts"
  ])("allows the allowlisted path %s", (file) => {
    expect(isWorkerMergeSafePath(file)).toBe(true);
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

/* ---------- standing in-run merge conditions (Action worker-applies-standing-merge-conditions) ---------- */

const CARD = "start-run-fixture-20261101";
const REVIEWED = "b".repeat(40);
const MARKER_URL = "https://github.com/pmark/arcadia/pull/7#issuecomment-99";
const BASE_ACTION = {
  id: "first-action", title: "T", next_action: "Do the thing.", acceptance_criteria: ["A one.", "B two."], references: ["src/b.ts", "src/a.ts"],
  depends_on: [], expected_artifact: "x"
};

function pinsFor(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "arcadia-start-run-v1", reviewedRevision: REVIEWED, executorSha256: "b".repeat(64), workspace: "martianrover", project: "arcadia",
    plan: "fixture-plan", actions: ["first-action", "write-feature"], provider: "claude-code-cli",
    transitions: ["validation", "acceptance", "pointer", "packet_approval"], concurrency: 1, packetApprovalHours: 24, intent: "A fixture run.",
    spendDecision: "0130", integrationDecision: "0058",
    requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162"],
    requiredFiles: ["scripts/start-run.sh"], production: { revision: 83, epoch: 46 }, queueRevision: 290, workerLabel: "com.arcadia.local.1.worker",
    gateCardId: "enable-capacity-gate-20261017", offId: "restore-off-production", grantedBy: "the operator",
    consumedHistory: [{ path: "/abs/one.consumed.json", sha256: "c".repeat(64) }], ...over
  };
}
const planText = (action: Record<string, unknown>, extra: Record<string, unknown>[] = []) => `---\n${stringifyYaml({ actions: [action, ...extra] })}---\n\n# Plan\n`;
const GATES: GateSetDocument = {
  gateSet: "v1",
  projects: { arcadia: { repository: "pmark/arcadia", gateModules: [{ id: "w", path: "src/production/workerMerge.ts", imports: [] }], spend: ["src/spend/"], hardClasses: [{ name: "decisions", paths: ["docs/decisions/"] }], self: [] } }
};
const NO_HARD_CLASSES: GateSetDocument = { gateSet: "v1", projects: { arcadia: { ...GATES.projects.arcadia, hardClasses: [] } } };
const decisionAnswering = (over: Record<string, unknown> = {}) => ({ id: "0260", status: "approved", question: `May Rowan merge for ${CARD}?`, answer: "A", ...over }) as { id: string; status: string; question: string; answer: string | null };
const reviewComments = (body: string) => () => ({ status: 0, stdout: JSON.stringify({ comments: [{ body, url: MARKER_URL }] }), stderr: "" });
const GOOD_REVIEW = `Independent review, head ${HEAD.slice(0, 12)}\nNo blocking findings.\nLoosens a gate: no\n`;

describe("standing in-run merge conditions C1-C5", () => {
  let dir: string;
  let library: string;
  let db: Database.Database;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "standing-merge-"));
    library = path.join(dir, "operator-scripts");
    mkdirSync(library);
    db = new Database(":memory:");
    ensureProductionPolicyTables(db);
    activate(CARD);
    writeCard(pinsFor());
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  function activate(requestId: string | null): void {
    const authority = requestId ? JSON.stringify({ requestId, grantedBy: "op", grantedAt: "2026-11-01T00:00:00Z", decisionRef: null, scopeFingerprint: "f" }) : null;
    db.prepare("UPDATE production_policy SET desired_state = 'active', authority_json = ? WHERE id = 'workspace'").run(authority);
  }
  function writeCard(pins: unknown): void { writeFileSync(path.join(library, `${CARD}.json`), JSON.stringify({ startRun: pins })); }
  const input = (over: Partial<StandingMergeInput> = {}): StandingMergeInput => ({
    db, repoRoot: dir, baseBranch: "main", head: HEAD, actionKey: "arcadia/first-action", pullRequestUrl: URL,
    changedPaths: ["apps/web/page.tsx"], runCommand: reviewComments(GOOD_REVIEW), ...over
  });
  /** Plan text at the approved revision and at merge-time main. */
  const deps = (approved: string | null, current: string | null, over: StandingMergeDeps = {}): StandingMergeDeps => ({
    libraryDir: () => library, decisions: () => [decisionAnswering()], gateSet: () => GATES,
    showFile: (revision) => (revision === REVIEWED ? approved : current), mergeTimeMain: () => "main-now", ...over
  });
  const same = planText(BASE_ACTION);
  const verdict = (current: string | null, over: Partial<StandingMergeInput> = {}, d: StandingMergeDeps = {}, approved: string | null = same) =>
    evaluateStandingMerge(input(over), deps(approved, current, d));
  const parkedAt = (v: ReturnType<typeof verdict>) => (v.ok ? "ok" : v.condition);

  it("passes when every condition holds, returning the card, Decision and review marker", () => {
    expect(verdict(same)).toMatchObject({ ok: true, cardId: CARD, decisionId: "0260", reviewMarkerUrl: MARKER_URL });
  });

  describe("C1: the approved requirement content", () => {
    it("keeps approval across whitespace-only edits, reordered references, and title or dependency changes", () => {
      const edited = planText({ ...BASE_ACTION, title: "New title", depends_on: ["other"], next_action: "  Do   the\nthing. ", acceptance_criteria: ["A   one.", "B two. "], references: ["src/a.ts", "src/b.ts"] });
      expect(parkedAt(verdict(edited))).toBe("ok");
    });
    it("hashes the documented canonical object, sorts references by code unit and keeps duplicates", () => {
      const got = planActionHash(planText({ id: "x", next_action: " a  b ", acceptance_criteria: ["z", "y"], references: ["b", "B", "b"] }), "x");
      const expected = createHash("sha256").update(JSON.stringify({ next_action: "a b", acceptance_criteria: ["z", "y"], references: ["B", "b", "b"] }), "utf8").digest("hex");
      expect(got).toEqual({ hash: expected });
      const missing = planActionHash(planText({ id: "x", next_action: "a" }), "x");
      expect(missing).toEqual({ hash: createHash("sha256").update(JSON.stringify({ next_action: "a", acceptance_criteria: [], references: [] }), "utf8").digest("hex") });
    });
    it.each([
      ["next_action text", { next_action: "Do another thing." }],
      ["an acceptance criterion", { acceptance_criteria: ["A one.", "B changed."] }],
      ["a reordered acceptance_criteria", { acceptance_criteria: ["B two.", "A one."] }],
      ["a newly named authority path in references", { references: ["src/b.ts", "src/a.ts", "docs/decisions/0001-x.md"] }]
    ])("parks on %s", (_name, change) => {
      const v = verdict(planText({ ...BASE_ACTION, ...change }));
      expect(parkedAt(v)).toBe("C1");
      if (!v.ok) expect(v.reason).toContain("requirement content changed");
    });
    it("parks added scope: an Action not pinned on the card", () => {
      const v = verdict(same, { actionKey: "arcadia/surprise-action" });
      expect(v).toMatchObject({ ok: false, condition: "C1" });
      if (!v.ok) expect(v.reason).toContain("not pinned");
    });
    it("parks on a card pressed under a delegation, which records no operator-pressed content", () => {
      writeCard(pinsFor({ plan: DELEGATION_SCOPE.plan, actions: [...DELEGATION_SCOPE.actions], requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162", "0163"], delegation: { decision: "0163", originatingCard: "start-run-origin-20261101", originatingRun: "20261101T010000Z-111", originatingReceiptSha256: "a".repeat(64), attempt: 2 } }));
      const v = verdict(same, { actionKey: `arcadia/${DELEGATION_SCOPE.actions[0]}` });
      expect(v).toMatchObject({ ok: false, condition: "C1" });
      if (!v.ok) expect(v.reason).toContain("delegation");
    });
    it("parks on an unreadable library, card, pins or revision, and on an Action with no next_action", () => {
      expect(parkedAt(evaluateStandingMerge(input(), deps(same, same, { libraryDir: () => path.join(dir, "missing") })))).toBe("C1");
      writeFileSync(path.join(library, `${CARD}.json`), "{not json");
      expect(parkedAt(verdict(same))).toBe("C1");
      writeCard({ ...pinsFor(), extraKey: 1 });
      expect(parkedAt(verdict(same))).toBe("C1");
      writeCard(pinsFor());
      expect(parkedAt(verdict(same, {}, {}, null))).toBe("C1");
      expect(parkedAt(verdict(null))).toBe("C1");
      expect(parkedAt(verdict("no front matter"))).toBe("C1");
      const { next_action: _omitted, ...noNext } = BASE_ACTION;
      expect(parkedAt(verdict(same, {}, {}, planText(noNext)))).toBe("C1");
    });
  });

  describe("C2: the exact-head independent review marker", () => {
    it("parks on a marker for another head, a missing Loosens line, a loosening review and an unreadable read", () => {
      for (const body of [`Independent review, head ${"c".repeat(12)}\nLoosens a gate: no\n`, `Independent review, head ${HEAD.slice(0, 12)}\nAll good.\n`, `Independent review, head ${HEAD.slice(0, 12)}\nLoosens a gate: yes\n`, "no marker here"]) {
        expect(parkedAt(verdict(same, { runCommand: reviewComments(body) }))).toBe("C2");
      }
      expect(parkedAt(verdict(same, { runCommand: () => ({ status: 1, stdout: "", stderr: "denied" }) }))).toBe("C2");
      expect(parkedAt(verdict(same, { runCommand: () => ({ status: 0, stdout: "nope", stderr: "" }) }))).toBe("C2");
    });
  });

  describe("C3: checks green and CLEAN (the pure worker gate, run after the standing lift)", () => {
    it("still refuses a pending or failed check when the standing conditions pass", () => {
      expect(codeOf(facts({ pullRequest: { ...facts().pullRequest!, mergeStateStatus: "BLOCKED" } }))).toBe("merge_state_not_clean");
      expect(codeOf(facts({ pullRequest: { ...facts().pullRequest!, statusCheckRollup: [{ ...GREEN[0], conclusion: "FAILURE" }] } }))).toBe("check_failed");
      expect(codeOf(facts())).toBe("ok");
    });
  });

  describe("C4: no shared gate set or hard class", () => {
    it("parks a diff that touches a gate module, the spend path, a gate-set hard class, or a batch-merge hard class", () => {
      for (const file of ["src/production/workerMerge.ts", "src/spend/limit.ts", "docs/decisions/0001-x.md"]) {
        expect(parkedAt(verdict(same, { changedPaths: ["apps/web/page.tsx", file] }))).toBe("C4");
      }
      const hard = classifyAuthorityPaths([".claude/settings.json"]);
      expect(hard).toContain("agent_permissions");
      const v = evaluateStandingMerge(input({ changedPaths: [".claude/settings.json"] }), deps(same, same, { gateSet: () => NO_HARD_CLASSES }));
      expect(v).toMatchObject({ ok: false, condition: "C4" });
    });
    it("parks on an unreadable diff or gate set, and passes an unprotected authority-adjacent path", () => {
      expect(parkedAt(verdict(same, { changedPaths: null }))).toBe("C4");
      expect(parkedAt(verdict(same, {}, { gateSet: () => { throw new Error("unreadable"); } }))).toBe("C4");
      expect(parkedAt(verdict(same, {}, { gateSet: () => ({ gateSet: "v1", projects: {} }) }))).toBe("C4");
      expect(parkedAt(verdict(same, { changedPaths: ["apps/web/page.tsx"] }))).toBe("ok");
    });
  });

  describe("C5: production still Active for the card", () => {
    it("parks when production is Off, has no card, or the policy cannot be read", () => {
      db.prepare("UPDATE production_policy SET desired_state = 'inactive'").run();
      expect(parkedAt(verdict(same))).toBe("C5");
      activate(null);
      expect(parkedAt(verdict(same))).toBe("C5");
      activate("Not A Slug!");
      expect(parkedAt(verdict(same))).toBe("C5");
      db.exec("DROP TABLE production_policy");
      expect(parkedAt(verdict(same))).toBe("C5");
    });
  });

  describe("the authorizing Decision (read from the Decision documents on main)", () => {
    it("authorizes only an approved, answered Decision whose question or answer names this card", () => {
      const named = (over: Record<string, unknown>) => findAuthorizingDecision([decisionAnswering(over)], CARD);
      expect(named({})).toBe("0260");
      expect(named({ question: "General question?", answer: `A for ${CARD}` })).toBe("0260");
      expect(named({ question: "May Rowan merge for another-card-20261101?" })).toBeNull();
      expect(named({ question: `May Rowan merge for ${CARD}-v2?` })).toBeNull();
      expect(named({ answer: null })).toBeNull();
      expect(named({ status: "open" })).toBeNull();
    });
    it("parks with a named reason for a Decision naming another card, none, or unreadable Decisions", () => {
      for (const d of [() => [decisionAnswering({ question: "For some-other-card?" })], () => [], () => null]) {
        const v = verdict(same, {}, { decisions: d });
        expect(v).toMatchObject({ ok: false, condition: "authorization" });
      }
    });
  });
});

describe("the standing merge in mergeCandidatePullRequest: receipt before the merge", () => {
  let root: string;
  let repo: string;
  let library: string;
  let github: FakeGitHub;
  let db: Database.Database;
  let head: string;
  const branch = "claude/write-feature-20261121T000000000Z";

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "standing-merge-flow-")));
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
    ensureProductionPolicyTables(db);
    db.prepare("UPDATE production_policy SET desired_state = 'active', authority_json = ? WHERE id = 'workspace'")
      .run(JSON.stringify({ requestId: CARD, grantedBy: "op", grantedAt: "2026-11-21T00:00:00Z", decisionRef: null, scopeFingerprint: "f" }));
    library = path.join(root, "operator-scripts");
    mkdirSync(library);
    writeFileSync(path.join(library, `${CARD}.json`), JSON.stringify({ startRun: pinsFor({ actions: ["write-feature"] }) }));
    // An authority-adjacent change: not on the worker-merge allowlist, but outside the shared gate set.
    git(repo, ["checkout", "-q", "-b", branch]);
    mkdirSync(path.join(repo, "apps/web"), { recursive: true });
    writeFileSync(path.join(repo, "apps/web/page.tsx"), "export default 1;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "agent work"]);
    writeFileSync(path.join(repo, "PROJECT.md"), "# Project\n\ncurrent_action: next\n");
    git(repo, ["commit", "-q", "-am", "settle completion"]);
    head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["checkout", "-q", "main"]);
    git(repo, ["push", "-q", "origin", branch]);
    github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
  });
  afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

  const plan = planText({ ...BASE_ACTION, id: "write-feature" });
  function run(standing: StandingMergeDeps = {}) {
    const marker = `Independent review, head ${head.slice(0, 12)}\nLoosens a gate: no\n`;
    return mergeCandidatePullRequest({
      db, repoRoot: repo, baseBranch: "main", sessionId: "session_1", actionKey: "arcadia/write-feature", head,
      settlementCommit: head, pullRequestUrl: URL, review: gateFor(head), now: new Date("2026-11-21T12:00:00Z")
    }, {
      runCommand: (call) => (call.args[0] === "pr" && call.args[1] === "view" && call.args.includes("comments") ? reviewComments(marker)() : github.runCommand(call)),
      mergeFreeze: () => null, decisionIdClash: () => null,
      standing: { libraryDir: () => library, showFile: () => plan, mergeTimeMain: () => "main", decisions: () => [decisionAnswering()], gateSet: () => GATES, releaseSha: () => "r".repeat(40), ...standing }
    });
  }
  const ghIndex = (needle: string) => github.ghCalls.findIndex((call) => call.startsWith(needle));

  it("posts the receipt comment before the merge call, with every receipt field", () => {
    const outcome = run();
    expect(outcome.kind).toBe("merged");
    const comment = ghIndex("gh pr comment");
    const merge = ghIndex("gh pr merge");
    expect(comment).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(comment);
    expect(github.ghCalls[merge]).toContain(`--match-head-commit ${head}`);
    const body = github.comments[0].body;
    for (const part of [CARD, head, MARKER_URL, "Loosens a gate: no", "SUCCESS", "CLEAN", "r".repeat(40), "0260"]) expect(body).toContain(part);
  });

  it("parks without a merge when the receipt cannot be posted", () => {
    github.commentFailures.push("rate limited");
    const outcome = run();
    expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    expect(ghIndex("gh pr merge")).toBe(-1);
  });

  it("leaves behavior unchanged without a matching Decision: the authority-adjacent PR waits and nothing is posted or merged", () => {
    for (const decisions of [() => [], () => [decisionAnswering({ question: "For another-card-20261101?" })]]) {
      const outcome = run({ decisions });
      expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
      if (outcome.kind === "refused") expect(outcome.reason).not.toContain("Standing merge parked");
    }
    expect(ghIndex("gh pr comment")).toBe(-1);
    expect(ghIndex("gh pr merge")).toBe(-1);
  });

  it("parks a PR whose diff touches the shared gate set or a hard class, even with a matching Decision", () => {
    const protectedApps: GateSetDocument = { gateSet: "v1", projects: { arcadia: { ...GATES.projects.arcadia, spend: ["apps/"] } } };
    const outcome = run({ gateSet: () => protectedApps });
    expect(outcome).toMatchObject({ kind: "refused", code: "authority_adjacent" });
    if (outcome.kind === "refused") expect(outcome.reason).toContain("Standing merge parked at C4");
    expect(ghIndex("gh pr merge")).toBe(-1);
  });
});
