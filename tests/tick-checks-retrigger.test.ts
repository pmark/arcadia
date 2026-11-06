import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { listReviewSteps } from "../src/production/independentReview.js";
import { resetProductionRepairBudget } from "../src/production/tick.js";
import type { PullRequestCheckRun } from "../src/qa/prReview.js";
import { ensureReviewRepairTable, requiredChecksRepairRequestId } from "../src/sessions/reviewRepair.js";
import type { AgentSession } from "../src/sessions/index.js";
import { git, LINE_A, Rehearsal, type RehearsalOptions } from "./helpers/rehearsalHarness.js";
import { rollup } from "./helpers/statusCheckRollups.js";

/**
 * The worker's one automatic re-trigger of a head's required checks
 * (Decision 0175; pmark/arcadia#1929 Action 5): on `required_checks_timeout`
 * for an unchanged head with no failure attributed to the candidate, checks
 * that never started (#2062: the pull_request event was lost in a GitHub
 * outage, so only CodeRabbit ever reported) are re-triggered by closing and
 * reopening the PR, and stuck GitHub Actions runs are cancelled and re-run,
 * once per head; one more checks window later the timeout escalates exactly
 * as before. Real tick, real Git, real database (each tick opens it afresh,
 * as a restarted worker would); only the GitHub CLI and the reviewer are fakes.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const WINDOW = 3 * 60_000;
const GREEN: PullRequestCheckRun[] = [{ name: "fast", status: "COMPLETED", conclusion: "SUCCESS" }];
const RUN_URL = "https://github.com/pmark/rehearsal/actions/runs/4242/job/77";
const STUCK: PullRequestCheckRun[] = [{ __typename: "CheckRun", name: "unit", status: "QUEUED", conclusion: null, detailsUrl: RUN_URL, workflowName: "CI" }];
const CANCELLED: PullRequestCheckRun[] = [{ __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: RUN_URL, workflowName: "CI" }];
const FAILED_IN_RUN: PullRequestCheckRun[] = [{ __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: RUN_URL, workflowName: "CI" }];

function finishedA(options: RehearsalOptions = {}): { rehearsal: Rehearsal; a: AgentSession } {
  const rehearsal = new Rehearsal({ independentReviewers: "tick", review: { checksDeadlineMs: WINDOW }, ...options });
  rehearsals.push(rehearsal);
  rehearsal.github.failCriteria = ["correctness"];
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  const a = rehearsal.lease()!;
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  rehearsal.agentFinish(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  return { rehearsal, a };
}

/** The exit tick and the ready tick: the PR is ready and its checks window has begun. */
function readied(rehearsal: Rehearsal): string {
  const exited = rehearsal.tick();
  expect(exited.reconciled[0]?.outcome).toBe("accepted_completion");
  rehearsal.tick();
  expect(rehearsal.github.readyCalls).toHaveLength(1);
  return rehearsal.github.prs[0].url;
}

function headOf(rehearsal: Rehearsal, session: AgentSession): string {
  return git(rehearsal.repo, ["rev-parse", `refs/heads/${session.branch}`]).trim();
}

function escalation(rehearsal: Rehearsal) {
  return rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA);
}

function ticks(rehearsal: Rehearsal, count: number): void {
  for (let i = 0; i < count; i += 1) rehearsal.tick();
}

function ghCount(rehearsal: Rehearsal, prefix: string): number {
  return rehearsal.github.ghCalls.filter((call) => call.startsWith(prefix)).length;
}

function retriggerLines(rehearsal: Rehearsal): string[] {
  return rehearsal.log.filter((line) => line.includes("Re-triggered the required checks"));
}

describe("the worker's once-per-head required-checks re-trigger", () => {
  it("replays #2062's lost CI event to one re-trigger, then escalates exactly as before, never twice on the same head", () => {
    const { rehearsal, a } = finishedA();
    // #2062: the pull_request event was lost, so only advisory CodeRabbit ever reported on the head.
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    const url = readied(rehearsal);
    ticks(rehearsal, 3); // the checks window elapses
    expect(rehearsal.github.closeCalls).toEqual([url]);
    expect(rehearsal.github.reopenCalls).toEqual([url]);
    expect(rehearsal.github.prs[0].state ?? "OPEN").toBe("OPEN");
    expect(retriggerLines(rehearsal)).toHaveLength(1);
    expect(retriggerLines(rehearsal)[0]).toContain(headOf(rehearsal, a).slice(0, 12));
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");

    // One more window, still no CI: the escalation is today's, naming the one re-trigger.
    ticks(rehearsal, 2);
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");
    ticks(rehearsal, 2);
    expect(escalation(rehearsal)).toMatchObject({
      kind: "required_checks_timeout",
      message: expect.stringContaining("one automatic re-trigger of this head (close and reopen of the PR"),
      remedy: expect.stringContaining("reset-repair-budget")
    });
    // A second timeout on the same head (the operator restarts the wait) escalates with no second re-trigger.
    withDatabase(rehearsal.workspace, (db) => resetProductionRepairBudget(db, rehearsal.actionA));
    ticks(rehearsal, 6);
    expect(escalation(rehearsal)?.kind).toBe("required_checks_timeout");
    expect(ghCount(rehearsal, "gh pr close")).toBe(1);
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(1);
    expect(retriggerLines(rehearsal)).toHaveLength(1);
    expect(rehearsal.github.reviewerCalls).toEqual([]);
  });

  it("reviews and integrates once the re-triggered checks turn green", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => rehearsal.github.reopenCalls.length > 0 ? GREEN : rollup("codeRabbitOnly");
    readied(rehearsal);
    ticks(rehearsal, 3);
    expect(rehearsal.github.reopenCalls).toHaveLength(1);
    rehearsal.tickUntil((r) => r.handoff?.integration.kind === "integrated", 4);
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review", "qa"]);
    expect(escalation(rehearsal)).toBeUndefined();
  });

  it("never re-triggers again after a restart: a recorded re-trigger (even one interrupted before GitHub) holds for the head", () => {
    const { rehearsal, a } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    readied(rehearsal);
    const head = headOf(rehearsal, a);
    ticks(rehearsal, 2);
    // A previous worker process recorded the re-trigger and died before its first GitHub call.
    withDatabase(rehearsal.workspace, (db) => {
      db.prepare("UPDATE production_review_steps SET checks_retrigger_at = ?, checks_retrigger_json = ? WHERE target_head = ?")
        .run(rehearsal.now.toISOString(), JSON.stringify({ route: "reopen", runIds: [], phase: "requested", detail: null }), head);
    });
    rehearsal.tick(); // the checks window elapses inside the recorded re-trigger's window
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");
    ticks(rehearsal, 2);
    expect(escalation(rehearsal)?.kind).toBe("required_checks_timeout");
    expect(ghCount(rehearsal, "gh pr close")).toBe(0);
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(0);
    expect(retriggerLines(rehearsal)).toEqual([]);
  });

  it("resets for a new head: a re-trigger recorded on another head never spends this one's", () => {
    const { rehearsal, a } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    const url = readied(rehearsal);
    withDatabase(rehearsal.workspace, (db) => {
      const [step] = listReviewSteps(db, rehearsal.actionA);
      const earlier = "0".repeat(40);
      db.prepare(`INSERT INTO production_review_steps (request_id, session_id, action_key, target_head, pull_request_url, policy_epoch,
          checks_retrigger_at, checks_retrigger_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`worker-tick-review-${a.id}-${earlier}`, a.id, rehearsal.actionA, earlier, url, step.policy_epoch, step.created_at,
          JSON.stringify({ route: "reopen", runIds: [], phase: "done", detail: null }), step.created_at, step.created_at);
    });
    ticks(rehearsal, 3);
    expect(rehearsal.github.reopenCalls).toEqual([url]);
    expect(retriggerLines(rehearsal)).toHaveLength(1);
  });

  it("never re-triggers checks whose failure was attributed to the candidate on this head", () => {
    const { rehearsal, a } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    const url = readied(rehearsal);
    const head = headOf(rehearsal, a);
    withDatabase(rehearsal.workspace, (db) => {
      ensureReviewRepairTable(db);
      const at = rehearsal.now.toISOString();
      db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
          start_revision, pull_request_url, role, verdict, summary, findings_json, failed_checks_json, outcome, reason, created_at, updated_at)
        VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, 'required-checks', 'failed (unit)', 'Red checks', '[]', '[]', 'escalated', 'attributed', ?, ?)`)
        .run(requiredChecksRepairRequestId(a.id, head), rehearsal.actionA, a.id, a.branch, head, head, url, at, at);
    });
    ticks(rehearsal, 3);
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_timeout", message: expect.stringContaining("No automatic re-trigger: a required-checks failure on this head was attributed") });
    expect(ghCount(rehearsal, "gh pr close")).toBe(0);
    expect(ghCount(rehearsal, "gh run")).toBe(0);
  });

  it("never re-runs a completed failure: red checks take the required_checks_failed path", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => FAILED_IN_RUN;
    rehearsal.github.runView = () => ({ headSha: "x", status: "completed" });
    readied(rehearsal);
    ticks(rehearsal, 6);
    expect(escalation(rehearsal)?.kind).toBe("required_checks_failed");
    expect(ghCount(rehearsal, "gh run cancel")).toBe(0);
    expect(ghCount(rehearsal, "gh run rerun")).toBe(0);
    expect(ghCount(rehearsal, "gh pr close")).toBe(0);
  });

  it("escalates as before when GitHub refuses the re-trigger, and never retries it on the same head", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    rehearsal.github.ghFailures["pr close"] = "HTTP 502: Bad Gateway (https://api.github.com/graphql)";
    readied(rehearsal);
    ticks(rehearsal, 3);
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_timeout", message: expect.stringContaining("failed: gh pr close") });
    ticks(rehearsal, 6);
    expect(escalation(rehearsal)?.kind).toBe("required_checks_timeout");
    expect(ghCount(rehearsal, "gh pr close")).toBe(1);
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(0);
    expect(rehearsal.github.prs[0].state ?? "OPEN").toBe("OPEN");
  });

  it("names the closed PR when GitHub refuses the reopen", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    rehearsal.github.stickyGhFailures["pr reopen"] = "HTTP 502: Bad Gateway";
    const url = readied(rehearsal);
    ticks(rehearsal, 3);
    expect(escalation(rehearsal)).toMatchObject({ kind: "required_checks_timeout", remedy: expect.stringContaining(`gh pr reopen ${url}`) });
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(3); // bounded attempts in the tick
    expect(ghCount(rehearsal, "gh pr close")).toBe(1);
    // The worker keeps retrying the reopen on later polls (never a second close).
    ticks(rehearsal, 1);
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(6);
    expect(escalation(rehearsal)?.remedy).toContain(`gh pr reopen ${url}`);
    expect(ghCount(rehearsal, "gh pr close")).toBe(1);
  });

  it("reopens on the next tick when the reopen failed, then waits as normal", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    rehearsal.github.stickyGhFailures["pr reopen"] = "HTTP 502: Bad Gateway";
    const url = readied(rehearsal);
    ticks(rehearsal, 3);
    expect(rehearsal.github.prs[0].state).toBe("CLOSED");
    delete rehearsal.github.stickyGhFailures["pr reopen"];
    rehearsal.tick();
    expect(rehearsal.github.reopenCalls).toEqual([url]);
    expect(rehearsal.github.prs[0].state).toBe("OPEN");
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");
    expect(ghCount(rehearsal, "gh pr close")).toBe(1);
  });

  it("reopens a PR left CLOSED by a worker that crashed between the close and the reopen", () => {
    const { rehearsal, a } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    const url = readied(rehearsal);
    const head = headOf(rehearsal, a);
    ticks(rehearsal, 2);
    withDatabase(rehearsal.workspace, (db) => {
      db.prepare("UPDATE production_review_steps SET checks_retrigger_at = ?, checks_retrigger_json = ? WHERE target_head = ?")
        .run(rehearsal.now.toISOString(), JSON.stringify({ route: "reopen", runIds: [], phase: "requested", detail: null }), head);
    });
    rehearsal.github.prs[0].state = "CLOSED";
    rehearsal.tick();
    expect(rehearsal.github.reopenCalls).toEqual([url]);
    expect(rehearsal.github.prs[0].state).toBe("OPEN");
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");
    expect(ghCount(rehearsal, "gh pr close")).toBe(0);
    rehearsal.tick();
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(1); // done: never reopened again
  });

  it("attempts the reopen and names the closed PR when gh pr close errors after GitHub closed it", () => {
    const { rehearsal } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    rehearsal.github.closeFailsAfterClosing = "context deadline exceeded";
    const url = readied(rehearsal);
    ticks(rehearsal, 3);
    expect(rehearsal.github.reopenCalls).toEqual([url]);
    expect(rehearsal.github.prs[0].state).toBe("OPEN");
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");

    // And when the reopen cannot succeed either, the remedy says the PR is closed.
    const second = finishedA();
    second.rehearsal.github.checks = () => rollup("codeRabbitOnly");
    second.rehearsal.github.closeFailsAfterClosing = "context deadline exceeded";
    second.rehearsal.github.stickyGhFailures["pr reopen"] = "HTTP 502: Bad Gateway";
    const secondUrl = readied(second.rehearsal);
    ticks(second.rehearsal, 3);
    expect(escalation(second.rehearsal)).toMatchObject({ kind: "required_checks_timeout", remedy: expect.stringContaining(`The PR is closed: reopen it with \`gh pr reopen ${secondUrl}\``) });
  });

  it("never reopens a MERGED PR, or a PR for a head the stale record does not belong to", () => {
    const { rehearsal, a } = finishedA();
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    const url = readied(rehearsal);
    const head = headOf(rehearsal, a);
    ticks(rehearsal, 2);
    withDatabase(rehearsal.workspace, (db) => {
      db.prepare("UPDATE production_review_steps SET checks_retrigger_at = ?, checks_retrigger_json = ? WHERE target_head = ?")
        .run(rehearsal.now.toISOString(), JSON.stringify({ route: "reopen", runIds: [], phase: "requested", detail: null }), head);
    });
    rehearsal.github.prs[0].state = "MERGED";
    ticks(rehearsal, 3);
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(0);

    // A record on a head other than the one the candidate is on is not this head's to act on.
    withDatabase(rehearsal.workspace, (db) => {
      db.prepare("UPDATE production_review_steps SET checks_retrigger_at = NULL, checks_retrigger_json = NULL WHERE target_head = ?").run(head);
      const [step] = listReviewSteps(db, rehearsal.actionA);
      const earlier = "0".repeat(40);
      db.prepare(`INSERT INTO production_review_steps (request_id, session_id, action_key, target_head, pull_request_url, policy_epoch,
          checks_retrigger_at, checks_retrigger_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`worker-tick-review-${a.id}-${earlier}`, a.id, rehearsal.actionA, earlier, url, step.policy_epoch, step.created_at,
          JSON.stringify({ route: "reopen", runIds: [], phase: "requested", detail: null }), step.created_at, step.created_at);
    });
    rehearsal.github.prs[0].state = "CLOSED";
    ticks(rehearsal, 3);
    expect(ghCount(rehearsal, "gh pr reopen")).toBe(0);
  });

  it("backs off a rate limit on the first re-trigger call and re-triggers once afterwards", () => {
    const { rehearsal } = finishedA({ review: { checksDeadlineMs: WINDOW, rateLimitBackoffMs: 60_000 } });
    rehearsal.github.checks = () => rollup("codeRabbitOnly");
    rehearsal.github.ghFailures["pr close"] = "API rate limit exceeded for user";
    const url = readied(rehearsal);
    ticks(rehearsal, 3);
    expect(rehearsal.github.closeCalls).toEqual([]);
    ticks(rehearsal, 2);
    expect(rehearsal.github.closeCalls).toEqual([url]);
    expect(rehearsal.github.reopenCalls).toEqual([url]);
    expect(retriggerLines(rehearsal)).toHaveLength(1);
  });

  it("cancels a stuck GitHub Actions run on the head, re-runs it once cancelled, and reviews once green", () => {
    const { rehearsal, a } = finishedA();
    let checks = STUCK;
    rehearsal.github.checks = () => checks;
    rehearsal.github.runView = (id) => id === "4242" ? { headSha: headOf(rehearsal, a), status: "queued" } : null;
    readied(rehearsal);
    ticks(rehearsal, 3);
    expect(rehearsal.github.runCancels).toEqual(["4242"]);
    expect(rehearsal.github.runReruns).toEqual([]);
    expect(ghCount(rehearsal, "gh pr close")).toBe(0);
    checks = CANCELLED;
    rehearsal.tick();
    expect(rehearsal.github.runReruns).toEqual(["4242"]);
    expect(escalation(rehearsal)?.kind).toBe("awaiting_independent_verdicts");
    checks = GREEN;
    rehearsal.tickUntil((r) => r.handoff?.integration.kind === "integrated", 4);
    expect(rehearsal.github.runCancels).toEqual(["4242"]);
    expect(rehearsal.github.runReruns).toEqual(["4242"]);
    expect(retriggerLines(rehearsal)).toHaveLength(1);
  });

  it("does not re-run a cancelled run that turns out to hold a real failure", () => {
    const { rehearsal, a } = finishedA();
    let checks = STUCK;
    rehearsal.github.checks = () => checks;
    rehearsal.github.runView = () => ({ headSha: headOf(rehearsal, a), status: "in_progress" });
    readied(rehearsal);
    ticks(rehearsal, 3);
    expect(rehearsal.github.runCancels).toEqual(["4242"]);
    checks = FAILED_IN_RUN;
    ticks(rehearsal, 3);
    expect(rehearsal.github.runReruns).toEqual([]);
    expect(escalation(rehearsal)?.kind).toBe("required_checks_failed");
  });

  it("does not touch a stuck run GitHub places on another head, nor a stuck check with no GitHub Actions run", () => {
    const other = finishedA();
    other.rehearsal.github.checks = () => STUCK;
    other.rehearsal.github.runView = () => ({ headSha: "f".repeat(40), status: "queued" });
    readied(other.rehearsal);
    ticks(other.rehearsal, 3);
    expect(escalation(other.rehearsal)).toMatchObject({ kind: "required_checks_timeout", message: expect.stringContaining("is not an unfinished run on") });
    expect(ghCount(other.rehearsal, "gh run cancel")).toBe(0);

    const context = finishedA();
    context.rehearsal.github.checks = () => rollup("pendingNonAdvisoryStatusContext");
    readied(context.rehearsal);
    ticks(context.rehearsal, 3);
    expect(escalation(context.rehearsal)).toMatchObject({ kind: "required_checks_timeout", message: expect.stringContaining("No automatic re-trigger: the stuck check") });
    expect(ghCount(context.rehearsal, "gh run")).toBe(0);
    expect(ghCount(context.rehearsal, "gh pr close")).toBe(0);
  });
});
