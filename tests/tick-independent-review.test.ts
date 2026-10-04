import { afterEach, describe, expect, it } from "vitest";
import { runProductionResetRepairBudgetCommand } from "../src/commands/production.js";
import { withDatabase } from "../src/db/connection.js";
import { listReviewSteps } from "../src/production/independentReview.js";
import { policyAuthorizesPullRequestReadiness } from "../src/production/policy.js";
import { ensureProductionTickTables } from "../src/production/tick.js";
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
      .toEqual([expect.objectContaining({ failures: 3, retry_role: "code-review" })]);

    rehearsal.github.reviewerExit = () => 0;
    const reset = runProductionResetRepairBudgetCommand({ workspace: rehearsal.workspace, actionKey: rehearsal.actionA });
    expect(reset.data.reviewStepsCleared).toBe(1);
    expect(escalation(rehearsal)).toBeUndefined();
    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(verdicts(rehearsal, "code-review").map((x) => [x.ordinal, x.status])).toEqual([[1, "failed"], [2, "failed"], [3, "failed"], [4, "passed"]]);
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
    expect(columns).toEqual(expect.arrayContaining(["request_id", "target_head", "policy_epoch", "ready_at", "checks_started_at", "failures", "retry_role"]));
  });
});
