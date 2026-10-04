import { afterEach, describe, expect, it } from "vitest";
import { runProductionResetRepairBudgetCommand } from "../src/commands/production.js";
import { withDatabase } from "../src/db/connection.js";
import { listReviewSteps } from "../src/production/independentReview.js";
import { policyAuthorizesPullRequestReadiness, PRODUCTION_CONTROL_DEADLINES } from "../src/production/policy.js";
import { MAX_TICK_DURATION_MS } from "../src/commands/worker.js";
import { ensureProductionTickTables, resetProductionRepairBudget } from "../src/production/tick.js";
import type { PullRequestCheckRun } from "../src/qa/prReview.js";
import { getSession, type AgentSession } from "../src/sessions/index.js";
import { git, LINE_A, Rehearsal, type RehearsalOptions } from "./helpers/rehearsalHarness.js";

/**
 * The worker tick's unattended review of a preserved managed candidate: it
 * pushes a settled head the PR does not show yet, readies the host-created
 * draft PR, waits for its required checks, then runs `arcadia qa code-review`
 * and `arcadia qa pr` itself, one step per tick, and integrates by the local
 * fast-forward. Real tick, real Git (a bare `origin`), real settlement and
 * real host review commands; only the GitHub CLI and the reviewer model are
 * stubbed (FakeGitHub in the harness).
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const PENDING: PullRequestCheckRun[] = [{ name: "fast", status: "IN_PROGRESS", conclusion: null }];
const FAILED: PullRequestCheckRun[] = [{ name: "fast", status: "COMPLETED", conclusion: "FAILURE" }];
const GREEN: PullRequestCheckRun[] = [{ name: "fast", status: "COMPLETED", conclusion: "SUCCESS" }];

/** A started rehearsal whose Action A Session has just finished; the next tick is its exit tick. */
function finishedA(options: RehearsalOptions = {}, finish: "settled" | "sandboxed" = "settled"): { rehearsal: Rehearsal; a: AgentSession } {
  const rehearsal = new Rehearsal({ independentReviewers: "tick", ...options });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  const a = rehearsal.lease()!;
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  if (finish === "settled") rehearsal.agentFinish(a, CRITERIA_A);
  else rehearsal.agentFinishSandboxed(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  return { rehearsal, a };
}

/** The exit tick: preserved behind a draft PR, accepted, waiting on verdicts. */
function exitTick(rehearsal: Rehearsal) {
  const exited = rehearsal.tick();
  expect(exited.reconciled[0]?.outcome).toBe("accepted_completion");
  expect(exited.handoff?.preservation).toMatchObject({ kind: "preserved", state: "IN PR" });
  expect(exited.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/current independent verdicts/) });
  expect(rehearsal.github.prs).toHaveLength(1);
  expect(rehearsal.github.prs[0].isDraft).toBe(true);
  return exited;
}

function head(rehearsal: Rehearsal, session: AgentSession): string {
  return git(rehearsal.repo, ["rev-parse", `refs/heads/${session.branch}`]).trim();
}

function escalation(rehearsal: Rehearsal) {
  return rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA);
}

function verdicts(rehearsal: Rehearsal, role: "code-review" | "qa") {
  return rehearsal.attempts("write-marker-a").filter((attempt) => attempt.role === role);
}

describe("tick-driven independent review", () => {
  it("readies the draft PR once, runs code review then QA on the exact head, integrates, and stays idempotent on later ticks", () => {
    const { rehearsal, a } = finishedA();
    exitTick(rehearsal);
    const candidate = head(rehearsal, a);
    expect(escalation(rehearsal)).toMatchObject({ kind: "awaiting_independent_verdicts", remedy: expect.stringContaining("No operator step is needed") });

    const ready = rehearsal.tick();
    expect(ready.handoff?.integration.kind).toBe("refused");
    expect(rehearsal.github.readyCalls).toEqual([rehearsal.github.prs[0].url]);
    expect(rehearsal.github.reviewerCalls).toEqual([]);

    rehearsal.tick();
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review"]);
    expect(verdicts(rehearsal, "code-review").map((x) => [x.status, x.target_head])).toEqual([["passed", candidate]]);
    expect(escalation(rehearsal)).toMatchObject({ kind: "awaiting_independent_verdicts" });

    const integrated = rehearsal.tick();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.github.reviewerCalls.map((call) => [call.role, call.head])).toEqual([["code-review", candidate], ["qa", candidate]]);
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(candidate);
    expect(escalation(rehearsal)).toBeUndefined();

    const ghCalls = rehearsal.github.ghCalls.length;
    for (let i = 0; i < 3; i += 1) rehearsal.tick();
    expect(rehearsal.github.readyCalls).toHaveLength(1);
    expect(rehearsal.github.reviewerCalls).toHaveLength(2);
    expect(rehearsal.github.ghCalls.filter((call) => call.startsWith("gh pr ready"))).toHaveLength(1);
    expect(rehearsal.github.ghCalls.length).toBeGreaterThanOrEqual(ghCalls);
    expect(verdicts(rehearsal, "code-review")).toHaveLength(1);
    expect(verdicts(rehearsal, "qa")).toHaveLength(1);
    // Integration is the local fast-forward only: origin's base never moves and nothing is merged on GitHub.
    expect(rehearsal.github.headOf("main")).toBe(git(rehearsal.repo, ["rev-list", "--max-parents=0", "refs/heads/main"]).trim());
    expect(rehearsal.github.ghCalls.some((call) => / merge\b/.test(call))).toBe(false);
  });

  it("reads GitHub at most once per poll interval", () => {
    const { rehearsal } = finishedA({ review: { pollIntervalMs: 3 * 60_000 } });
    exitTick(rehearsal);
    rehearsal.tick();
    expect(rehearsal.github.readyCalls).toHaveLength(1);
    const calls = rehearsal.github.ghCalls.length;
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.github.ghCalls).toHaveLength(calls);
    rehearsal.tick();
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review"]);
  });

  it("keeps a blocked step's escalation between polls instead of flapping back to a plain wait", () => {
    const { rehearsal } = finishedA({ review: { pollIntervalMs: 3 * 60_000 } });
    rehearsal.github.checks = () => FAILED;
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.tick();
    rehearsal.tick();
    rehearsal.tick(); // first poll after ready: failed checks
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_failed" });
    const escalated = rehearsal.log.filter((line) => line.includes("(required_checks_failed)")).length;
    rehearsal.tick();
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_failed" });
    expect(rehearsal.log.filter((line) => line.includes("(required_checks_failed)"))).toHaveLength(escalated);
    expect(rehearsal.github.reviewerCalls).toEqual([]);
  });

  it("pushes a settlement commit that landed after preservation, and requests verdicts only for that settled head", () => {
    const { rehearsal, a } = finishedA({ provider: { id: "codex-cli", profile: "codex_build" } }, "sandboxed");
    exitTick(rehearsal);
    const settled = head(rehearsal, a);
    const preserved = withDatabase(rehearsal.workspace, (db) =>
      (db.prepare("SELECT commit_sha FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${a.id}`) as { commit_sha: string }).commit_sha);
    // Host settlement committed after preservation pushed the PR: the PR still shows the preserved commit.
    expect(settled).not.toBe(preserved);
    expect(git(rehearsal.repo, ["merge-base", "--is-ancestor", preserved, settled])).toBe("");
    expect(rehearsal.github.headOf(a.branch)).toBe(preserved);

    rehearsal.tick();
    expect(rehearsal.github.headOf(a.branch)).toBe(settled);
    // The push names the exact settled commit, never whatever the local tip is.
    expect(rehearsal.github.pushes.at(-1)).toEqual({ branch: a.branch, commitSha: settled });
    expect(rehearsal.github.readyCalls).toEqual([]);
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    expect(rehearsal.log.some((line) => line.includes(`Pushed settled head ${settled.slice(0, 12)}`))).toBe(true);

    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.github.readyCalls).toHaveLength(1);
    expect(rehearsal.github.reviewerCalls.map((call) => [call.role, call.head])).toEqual([["code-review", settled], ["qa", settled]]);
    for (const role of ["code-review", "qa"] as const) expect(verdicts(rehearsal, role).map((x) => x.target_head)).toEqual([settled]);
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(settled);
  });

  it("never readies or reviews a PR whose head moved off the settled candidate, and resumes once it is restored", () => {
    const { rehearsal, a } = finishedA();
    exitTick(rehearsal);
    const settled = head(rehearsal, a);
    // Someone else pushes an unrelated commit to the candidate branch on origin.
    const foreign = git(rehearsal.repo, ["commit-tree", `${settled}^{tree}`, "-p", `${settled}~1`, "-m", "foreign"]).trim();
    git(rehearsal.repo, ["push", "-q", "-f", "origin", `${foreign}:refs/heads/${a.branch}`]);

    for (let i = 0; i < 2; i += 1) {
      const blocked = rehearsal.tick();
      expect(blocked.handoff?.integration.kind).toBe("refused");
    }
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_head_moved", remedy: expect.stringContaining(settled) });
    expect(rehearsal.github.readyCalls).toEqual([]);
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    expect(verdicts(rehearsal, "code-review")).toEqual([]);
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).not.toBe(settled);

    git(rehearsal.repo, ["push", "-q", "-f", "origin", `${settled}:refs/heads/${a.branch}`]);
    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.github.reviewerCalls.map((call) => call.head)).toEqual([settled, settled]);
  });

  it("waits on pending checks, escalates a failure and a timeout without running a reviewer, and reviews once they are green", () => {
    const { rehearsal } = finishedA({ review: { checksDeadlineMs: 3 * 60_000 } });
    rehearsal.github.checks = () => PENDING;
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "awaiting_independent_verdicts", remedy: expect.stringContaining("Waiting for required checks") });
    rehearsal.tick();
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_timeout", remedy: expect.stringContaining("reset-repair-budget") });

    rehearsal.github.checks = () => FAILED;
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_failed" });
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    expect(verdicts(rehearsal, "code-review")).toEqual([]);

    // A GitHub re-run turns the same head green: the tick reviews and integrates.
    rehearsal.github.checks = () => GREEN;
    rehearsal.tick();
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review"]);
    const integrated = rehearsal.tick();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(escalation(rehearsal)).toBeUndefined();
    expect(rehearsal.github.readyCalls).toHaveLength(1);
  });

  it("withholds every step while Off, integrates nothing that a reviewer finished under Off, and resumes under the next epoch", () => {
    const { rehearsal } = finishedA();
    exitTick(rehearsal);
    // Off lands right after `gh pr ready` took effect.
    rehearsal.github.afterReady = () => { rehearsal.deactivate("off-after-ready"); };
    rehearsal.tick();
    expect(rehearsal.github.readyCalls).toHaveLength(1);
    for (let i = 0; i < 3; i += 1) rehearsal.tick();
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    expect(rehearsal.github.readyCalls).toHaveLength(1);

    rehearsal.activate("on-again-after-ready");
    // Off lands while the QA reviewer runs: its verdict is recorded, but the fast-forward is withheld.
    rehearsal.tick();
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review"]);
    rehearsal.github.duringReview = () => { rehearsal.deactivate("off-during-qa"); };
    const withheld = rehearsal.tick();
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review", "qa"]);
    expect(verdicts(rehearsal, "qa").map((x) => x.status)).toEqual(["passed"]);
    expect(withheld.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/authority changed/) });
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).not.toBe(verdicts(rehearsal, "qa")[0].target_head);
    expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");

    rehearsal.activate("on-again-after-qa");
    expect(rehearsal.tick().handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.github.reviewerCalls).toHaveLength(2);
    expect(rehearsal.github.readyCalls).toHaveLength(1);
  });

  it("withholds the reviewer when the policy epoch changes between reading the PR and running it", () => {
    const { rehearsal } = finishedA();
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    let flipped = false;
    rehearsal.github.checks = () => {
      if (!flipped) {
        flipped = true;
        rehearsal.deactivate("off-mid-step");
        rehearsal.activate("on-mid-step");
      }
      return GREEN;
    };
    const fenced = rehearsal.tick();
    expect(fenced.handoff?.integration.kind).toBe("refused");
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.log.some((line) => /resumes under production epoch/.test(line))).toBe(true);
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review", "qa"]);
  });

  it("retries reviewer-capacity failures within a budget that survives restart, escalates when it is exhausted, and resumes after reset", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.reviewerExit = () => 1;
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    for (let i = 0; i < 3; i += 1) rehearsal.tick();
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review", "code-review", "code-review"]);
    expect(verdicts(rehearsal, "code-review").map((x) => [x.ordinal, x.status])).toEqual([[1, "failed"], [2, "failed"], [3, "failed"]]);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_budget_exhausted", remedy: expect.stringContaining(`reset-repair-budget ${rehearsal.actionA}`) });
    // The budget is durable: later ticks (fresh connections) spend nothing.
    for (let i = 0; i < 2; i += 1) rehearsal.tick();
    expect(rehearsal.github.reviewerCalls).toHaveLength(3);
    expect(withDatabase(rehearsal.workspace, (db) => { ensureProductionTickTables(db); return listReviewSteps(db, rehearsal.actionA); }))
      .toEqual([expect.objectContaining({ failures: 3, failure_step: "code-review" })]);

    rehearsal.github.reviewerExit = () => 0;
    const reset = runProductionResetRepairBudgetCommand({ workspace: rehearsal.workspace, actionKey: rehearsal.actionA });
    expect(reset.data.reviewStepsCleared).toBe(1);
    expect(escalation(rehearsal)).toBeUndefined();
    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(verdicts(rehearsal, "code-review").map((x) => [x.ordinal, x.status])).toEqual([[1, "failed"], [2, "failed"], [3, "failed"], [4, "passed"]]);
  });

  it("re-runs a reviewer-unavailable verdict once, but never re-runs or integrates the real failed verdict that follows", () => {
    const { rehearsal } = finishedA();
    let calls = 0;
    rehearsal.github.reviewerExit = () => (calls++ === 0 ? 1 : 0);
    rehearsal.github.verdict = (role) => (role === "code-review" ? "fail" : "pass");
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.tick(); // code review: reviewer unavailable
    rehearsal.tick(); // authorized re-run: a real failed judgment
    for (let i = 0; i < 4; i += 1) expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review", "code-review"]);
    expect(verdicts(rehearsal, "code-review").map((x) => [x.ordinal, x.status])).toEqual([[1, "failed"], [2, "failed"]]);
    expect(verdicts(rehearsal, "code-review").map((x) => typeof JSON.parse(x.terminal_receipt_json!).reviewerUnavailable)).toEqual(["string", "object"]);
    expect(verdicts(rehearsal, "qa")).toEqual([]);
    expect(escalation(rehearsal)).toMatchObject({ kind: "independent_verdict_failed" });
  });

  it("bounds the tick's reviewer well under the worker tick ceiling, reports progress before it, and spends the budget on timeouts", () => {
    expect(PRODUCTION_CONTROL_DEADLINES.tickReviewerTimeoutMs).toBeLessThanOrEqual(MAX_TICK_DURATION_MS / 2);
    const { rehearsal } = finishedA();
    rehearsal.github.reviewerTimesOut = () => true;
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    let heartbeatsBeforeReviewer = -1;
    rehearsal.github.duringReview = () => { heartbeatsBeforeReviewer = rehearsal.heartbeats; };
    const before = rehearsal.heartbeats;
    rehearsal.tick();
    // The progress point (which re-stamps the worker's tick-ceiling marker) came right before the reviewer started.
    expect(heartbeatsBeforeReviewer).toBeGreaterThan(before);
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.github.reviewerTimeouts).toEqual([1, 2, 3].map(() => PRODUCTION_CONTROL_DEADLINES.tickReviewerTimeoutMs));
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_budget_exhausted", message: expect.stringMatching(/ETIMEDOUT/) });
    expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");
    expect(rehearsal.github.reviewerCalls).toHaveLength(3);
  });

  it("treats BLOCKED as waiting while required checks run, and escalates it only once they are green", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => PENDING;
    rehearsal.github.mergeState = () => "BLOCKED";
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.tick();
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "awaiting_independent_verdicts", remedy: expect.stringContaining("Waiting for required checks") });
    rehearsal.github.checks = () => GREEN;
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_pull_request_unavailable", message: expect.stringMatching(/branch protection/) });
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    rehearsal.github.mergeState = () => "CLEAN";
    rehearsal.tick();
    expect(rehearsal.tick().handoff?.integration.kind).toBe("integrated");
  });

  it("counts only consecutive failures, and backs off on a GitHub rate limit without spending the budget", () => {
    const { rehearsal } = finishedA();
    exitTick(rehearsal);
    rehearsal.github.viewFailures = ["HTTP 502: bad gateway", "HTTP 502: bad gateway"];
    rehearsal.tick();
    rehearsal.tick();
    rehearsal.tick(); // read succeeds: the streak resets, and the PR is readied
    expect(rehearsal.github.readyCalls).toHaveLength(1);
    rehearsal.github.viewFailures = ["HTTP 502: bad gateway", "HTTP 502: bad gateway"];
    rehearsal.tick();
    rehearsal.tick();
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");
    rehearsal.github.viewFailures = ["API rate limit exceeded for installation"];
    rehearsal.tick();
    const steps = () => withDatabase(rehearsal.workspace, (db) => listReviewSteps(db, rehearsal.actionA));
    expect(steps()[0]).toMatchObject({ failures: 2, failure_step: "read", backoff_until: expect.any(String) });
    const calls = rehearsal.github.ghCalls.length;
    for (let i = 0; i < 5; i += 1) rehearsal.tick();
    expect(rehearsal.github.ghCalls).toHaveLength(calls);
    const { integrated } = rehearsal.tickThroughReview(20);
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(steps()[0]).toMatchObject({ failures: 0 });
  });

  it("does not re-ready a PR a person returned to draft; it escalates and resumes once it is ready again", () => {
    const { rehearsal } = finishedA();
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.github.prs[0].isDraft = true;
    rehearsal.tick();
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_paused_as_draft", remedy: expect.stringContaining("gh pr ready") });
    expect(rehearsal.github.readyCalls).toHaveLength(1);
    expect(rehearsal.github.reviewerCalls).toEqual([]);
    rehearsal.github.prs[0].isDraft = false;
    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.github.readyCalls).toHaveLength(1);
  });

  it("refuses the fast-forward when the integration grant expires while a reviewer runs", () => {
    const { rehearsal, a } = finishedA();
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.tick(); // code review
    rehearsal.github.duringReview = () => { rehearsal.now = new Date(rehearsal.now.getTime() + 13 * 3_600_000); };
    const expired = rehearsal.tick();
    expect(verdicts(rehearsal, "qa").map((x) => x.status)).toEqual(["passed"]);
    expect(expired.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/authority changed.*expired/) });
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).not.toBe(head(rehearsal, a));
  });

  it.each(["Independent review unavailable", "Reviewer sandbox boundary is unavailable", "QA evidence is stale"])(
    "never treats a model-written %s finding as reviewer unavailability: the real fail is not re-run and never integrates",
    (title) => {
      const { rehearsal } = finishedA();
      rehearsal.github.verdict = (role) => (role === "code-review" ? "fail" : "pass");
      rehearsal.github.findingTitle = title;
      exitTick(rehearsal);
      rehearsal.tick(); // ready
      for (let i = 0; i < 4; i += 1) expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");
      expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review"]);
      expect(verdicts(rehearsal, "code-review").map((x) => [x.status, JSON.parse(x.terminal_receipt_json!).reviewerUnavailable])).toEqual([["failed", null]]);
      expect(escalation(rehearsal)).toMatchObject({ kind: "independent_verdict_failed" });
    }
  );

  it("records genuine (deterministic) reviewer unavailability in the receipt, and re-runs only that", () => {
    const { rehearsal } = finishedA();
    let calls = 0;
    rehearsal.github.reviewerExit = () => (calls++ === 0 ? 1 : 0);
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.tick(); // unavailable
    expect(JSON.parse(verdicts(rehearsal, "code-review")[0].terminal_receipt_json!).reviewerUnavailable).toMatch(/exited with status 1/);
    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(verdicts(rehearsal, "code-review").map((x) => x.status)).toEqual(["failed", "passed"]);
  });

  it("caps alternating failures that never form a streak with a total per-head budget", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.reviewerExit = () => 1;
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    for (let i = 0; i < 9; i += 1) {
      if (i % 2 === 0) rehearsal.github.viewFailures = ["HTTP 502: bad gateway"];
      rehearsal.tick();
    }
    const [row] = withDatabase(rehearsal.workspace, (db) => listReviewSteps(db, rehearsal.actionA));
    expect(row.total_failures).toBe(9);
    expect(row.failures).toBeLessThan(3);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_budget_exhausted", message: expect.stringMatching(/in all/) });
    const reviewerCalls = rehearsal.github.reviewerCalls.length;
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.github.reviewerCalls).toHaveLength(reviewerCalls);
  });

  it("escalates continuous rate limiting after a bounded time without spending the budget, and resumes when GitHub answers", () => {
    const { rehearsal } = finishedA({ review: { rateLimitBackoffMs: 60_000, rateLimitEscalateAfterMs: 3 * 60_000 } });
    exitTick(rehearsal);
    rehearsal.github.viewFailures = Array.from({ length: 5 }, () => "API rate limit exceeded");
    for (let i = 0; i < 4; i += 1) rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_rate_limited", remedy: expect.stringContaining("gh api rate_limit") });
    const [row] = withDatabase(rehearsal.workspace, (db) => listReviewSteps(db, rehearsal.actionA));
    expect(row).toMatchObject({ failures: 0, total_failures: 0 });
    rehearsal.github.viewFailures = [];
    const { integrated } = rehearsal.tickThroughReview(8);
    expect(integrated.handoff?.integration.kind).toBe("integrated");
  });

  it("keeps an open blocked escalation through a rate-limit backoff", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => FAILED;
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_failed" });
    rehearsal.github.viewFailures = ["API rate limit exceeded"];
    for (let i = 0; i < 3; i += 1) {
      rehearsal.tick();
      expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_failed" });
    }
  });

  it("never retries or integrates a real failed verdict", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.verdict = (role) => (role === "code-review" ? "fail" : "pass");
    exitTick(rehearsal);
    rehearsal.tick(); // ready
    for (let i = 0; i < 4; i += 1) expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review"]);
    expect(verdicts(rehearsal, "code-review").map((x) => x.status)).toEqual(["failed"]);
    expect(verdicts(rehearsal, "qa")).toEqual([]);
    expect(escalation(rehearsal)).toMatchObject({ kind: "independent_verdict_failed", remedy: expect.stringContaining("--rerun") });
  });

  it("drives nothing on GitHub without a current integration grant: the PR stays a draft", () => {
    const { rehearsal } = finishedA({ withoutIntegrationGrant: true });
    const exited = rehearsal.tick();
    expect(exited.handoff?.preservation).toMatchObject({ kind: "preserved", state: "IN PR" });
    for (let i = 0; i < 3; i += 1) {
      expect(rehearsal.tick().handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/No candidate-integration grant/) });
    }
    expect(rehearsal.github.ghCalls).toEqual([]);
    expect(rehearsal.github.prs[0].isDraft).toBe(true);
  });
});

describe("tick-driven review is not applicable to a LOCAL ONLY candidate", () => {
  it("keeps the awaiting escalation and names --remote-preservation in its remedy", () => {
    const rehearsal = new Rehearsal({ independentReviewers: false });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate();
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const a = rehearsal.lease()!;
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    rehearsal.tick();
    rehearsal.tick();
    const session = withDatabase(rehearsal.workspace, (db) => getSession(db, a.id)!);
    expect(session.status).toBe("completed");
    expect(escalation(rehearsal)).toMatchObject({
      kind: "awaiting_independent_verdicts",
      remedy: expect.stringMatching(/LOCAL ONLY.*--remote-preservation/s)
    });
  });
});

describe("what authorizes the tick to ready a PR", () => {
  const scope = {
    intent: "x", projects: ["p"], plans: ["p/plan"], actions: ["p/a"], providers: ["claude-code-cli"], maxConcurrentSessions: 1,
    mechanicalTransitions: ["validation" as const], remotePreservation: true,
    integrationGrant: { decisionRef: "0058", expiresAt: "2026-10-04T00:00:00.000Z", actions: [] as string[] }
  };
  const now = new Date("2026-10-03T12:00:00.000Z");
  it("requires an Active policy, --remote-preservation and a current Decision 0058 grant naming the Action", () => {
    expect(policyAuthorizesPullRequestReadiness({ desiredState: "active", scope }, "p/a", now)).toEqual({ authorized: true });
    expect(policyAuthorizesPullRequestReadiness({ desiredState: "inactive", scope }, "p/a", now)).toMatchObject({ authorized: false });
    expect(policyAuthorizesPullRequestReadiness({ desiredState: "active", scope: { ...scope, remotePreservation: false } }, "p/a", now))
      .toMatchObject({ authorized: false, reason: expect.stringMatching(/--remote-preservation/) });
    expect(policyAuthorizesPullRequestReadiness({ desiredState: "active", scope: { ...scope, integrationGrant: undefined } }, "p/a", now))
      .toMatchObject({ authorized: false, reason: expect.stringMatching(/0058/) });
    expect(policyAuthorizesPullRequestReadiness({ desiredState: "active", scope: { ...scope, integrationGrant: { ...scope.integrationGrant, actions: ["p/other"] } } }, "p/a", now))
      .toMatchObject({ authorized: false, reason: expect.stringMatching(/does not name/) });
    expect(policyAuthorizesPullRequestReadiness({ desiredState: "active", scope }, "p/a", new Date("2026-10-04T00:00:00.000Z")))
      .toMatchObject({ authorized: false, reason: expect.stringMatching(/expired/) });
    expect(policyAuthorizesPullRequestReadiness({ desiredState: "active", scope }, "p/b", now)).toMatchObject({ authorized: false });
  });
});

describe("production_review_steps migration", () => {
  it("adds the columns a database from an earlier build of the table lacks", () => {
    const rehearsal = new Rehearsal({ independentReviewers: false });
    rehearsals.push(rehearsal);
    const row = withDatabase(rehearsal.workspace, (db) => {
      ensureProductionTickTables(db);
      db.exec("DROP TABLE production_review_steps");
      // The shape the first candidate build (391fd6367) created.
      db.exec(`CREATE TABLE production_review_steps (
        request_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, action_key TEXT NOT NULL, target_head TEXT NOT NULL,
        pull_request_url TEXT NOT NULL, policy_epoch INTEGER NOT NULL, pushed_at TEXT, ready_at TEXT, checks_started_at TEXT,
        last_polled_at TEXT, failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, retry_role TEXT, last_outcome_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      db.prepare(`INSERT INTO production_review_steps (request_id, session_id, action_key, target_head, pull_request_url, policy_epoch, failures, retry_role, created_at, updated_at)
        VALUES ('r', 's', 'p/a', 'h', 'u', 1, 2, 'qa', 't', 't')`).run();
      ensureProductionTickTables(db);
      ensureProductionTickTables(db);
      return listReviewSteps(db, "p/a")[0];
    });
    expect(row).toMatchObject({ failures: 2, failure_step: null, total_failures: 0, backoff_until: null, backoff_started_at: null });
    const reset = withDatabase(rehearsal.workspace, (db) => resetProductionRepairBudget(db, "p/a"));
    expect(reset.reviewStepsCleared).toBe(1);
  });

  it("is created idempotently on an existing workspace database that predates it", () => {
    const rehearsal = new Rehearsal({ independentReviewers: false });
    rehearsals.push(rehearsal);
    const columns = withDatabase(rehearsal.workspace, (db) => {
      ensureProductionTickTables(db);
      db.exec("DROP TABLE production_review_steps");
      ensureProductionTickTables(db);
      ensureProductionTickTables(db);
      return (db.prepare("PRAGMA table_info(production_review_steps)").all() as Array<{ name: string }>).map((column) => column.name);
    });
    expect(columns).toEqual(expect.arrayContaining(["request_id", "target_head", "policy_epoch", "ready_at", "checks_started_at", "failures", "failure_step", "backoff_until"]));
  });
});
