import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withReadOnlyDatabase } from "../../src/db/connection.js";
import { listReviewRepairs } from "../../src/sessions/reviewRepair.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ActionWork, ExecutorResult, LaunchRecord } from "./helpers/executor.js";
import type { ScenarioReport } from "./helpers/report.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS, WORK } from "./helpers/world.js";

/**
 * The production worker's review repair loop (live 2026-10-18: PR #1535's
 * code review failed with a real finding, the worker recorded it, launched
 * nothing and left the PR ready; the operator merged it by mistake). Real
 * worker tick, preservation, settlement, both review commands and
 * integration; only the reviewer model, GitHub, tmux and the agent faked.
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

/** What a repair agent writes: the Action's own work plus a fix the failing head lacked. */
const repairWork = (round: number): ActionWork => ({
  files: { ...(WORK[ACTION_1].files as Record<string, string>), "REPAIR.md": `fixed in repair round ${round}\n` },
  validation: WORK[ACTION_1].validation
});
const exitReceipt = (world: FastRehearsal, sessionId: string) => withReadOnlyDatabase(world.workspace, (db) =>
  db.prepare("SELECT outcome, superseded_by_session_id FROM session_exit_receipts WHERE session_id = ?").get(sessionId) as { outcome: string; superseded_by_session_id: string | null });
const settlements = (world: FastRehearsal) => withReadOnlyDatabase(world.workspace, (db) =>
  db.prepare("SELECT id, receipt_json FROM agent_ask_settlements ORDER BY created_at").all() as Array<{ id: string; receipt_json: string }>)
  .map((row) => ({ id: row.id, documentsCommit: (JSON.parse(row.receipt_json) as { documentsCommit?: string }).documentsCommit ?? null }));

/** Tick until a repair Session for `actionId` is launched; returns its Session and launch. */
function untilRepairLaunched(world: FastRehearsal, sessionsBefore: number, limit = 10): { sessionId: string; launch: LaunchRecord } {
  world.tickUntil(() => world.sessions().length > sessionsBefore && world.lease() !== null, limit);
  const session = world.lease()!;
  const launch = world.tmux.launches.find((entry) => entry.name === session.tmux_session_name)!;
  return { sessionId: session.id, launch };
}

describe("a failed code review: draft PR with the findings, one repair Session, re-review, integration", () => {
  let world: FastRehearsal;
  let failedBranch = "";
  let failedHead = "";
  let failedSessionId = "";
  let repairSessionId = "";
  let repairBrief = "";
  let repaired: ExecutorResult;
  let report: ScenarioReport;
  beforeAll(() => {
    world = new FastRehearsal("review-repair-then-pass", isolation, import.meta.filename);
    worlds.push(world);
    world.expectError(/independent_verdict_failed|code-review: failed|verdict on [0-9a-f]+ (is fail|failed)/);
    world.github.findingTitle = "The test never asserts the temporary launcher directory was removed";
    world.github.failCriteria = ["correctness"];
    world.github.verdict = (role, pr) => (role === "code-review" && pr?.branch === failedBranch ? "fail" : "pass");
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    failedBranch = first.session.branch;
    failedSessionId = first.session.id;
    const one = world.execute(first.launch, ACTION_1);
    failedHead = one.finalHead;
    const repair = untilRepairLaunched(world, 1);
    repairSessionId = repair.sessionId;
    repairBrief = repair.launch.args.at(-1) ?? "";
    repaired = world.execute(repair.launch, ACTION_1, "clean", repairWork(1));
    world.untilIntegrated(ACTION_1, 12);
    const second = world.untilLaunched(ACTION_2, 4);
    world.execute(second.launch, ACTION_2);
    world.untilIntegrated(ACTION_2);
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("returns the failed PR to draft and posts one comment with the verdict, the finding and the round", () => {
    const failedPr = world.gh.prs.find((pr) => pr.branch === failedBranch)!;
    expect(failedPr.isDraft).toBe(true);
    expect(world.github.undoReadyCalls).toEqual([failedPr.url]);
    const comments = world.github.comments.filter((comment) => comment.url === failedPr.url);
    expect(comments).toHaveLength(2);
    expect(comments[0].body).toContain(failedHead);
    expect(comments[0].body).toContain("The test never asserts the temporary launcher directory was removed");
    expect(comments[0].body).toContain("Do not merge: the repair loop will push a fixed head (round 1 of 3)");
    // Once the repair has its own PR, the failed one is closed with a pointer to it.
    const repairPr = world.gh.prs.find((pr) => pr.branch !== failedBranch && pr.url !== failedPr.url && world.sessions().some((s) => s.id === repairSessionId && s.branch === pr.branch))!;
    expect(failedPr.state).toBe("CLOSED");
    expect(world.github.closeCalls).toEqual([failedPr.url]);
    expect(comments[1].body).toContain(`Superseded by ${repairPr.url}`);
    expect(comments[1].body).toContain("do not merge");
    expect(world.github.mergeCalls).toEqual([]);
  });

  it("launches the repair on a new branch from the failed head's pre-settlement work, with the finding in its brief", () => {
    const repair = world.sessions().find((session) => session.id === repairSessionId)!;
    expect(repair.action_id).toBe(ACTION_1);
    expect(repair.branch).not.toBe(failedBranch);
    expect(repair.launch_revision).toBe(git(world.repo, ["rev-parse", `${failedHead}^`]).trim());
    expect(repairBrief).toContain("Repair — this Session repairs a candidate an independent reviewer did not pass (repair round 1 of 3)");
    expect(repairBrief).toContain(`head ${failedHead}`);
    expect(repairBrief).toContain("1. [blocker] The test never asserts the temporary launcher directory was removed");
    // The failed candidate's accepted exit is superseded by the repair, in the same commit that created it.
    expect(exitReceipt(world, failedSessionId)).toEqual({ outcome: "accepted_completion", superseded_by_session_id: repairSessionId });
  });

  it("re-reviews the repaired head from scratch and integrates it, never the failed settlement", () => {
    const main = git(world.repo, ["rev-list", "refs/heads/main"]).split("\n");
    expect(main).toContain(repaired.finalHead);
    expect(main).not.toContain(failedHead);
    const reviewed = world.github.reviewerCalls.map((call) => [call.role, call.head === failedHead ? "failed-head" : call.head === repaired.finalHead ? "repaired-head" : call.head]);
    expect(reviewed.slice(0, 3)).toEqual([["code-review", "failed-head"], ["code-review", "repaired-head"], ["qa", "repaired-head"]]);
    // A fresh settlement on the repaired branch; the failed one never vouches for it.
    const [failedSettlement, repairSettlement] = settlements(world);
    expect(failedSettlement.documentsCommit).toBe(failedHead);
    expect(repairSettlement.documentsCommit).toBe(repaired.settlementCommit);
    expect(repairSettlement.id).not.toBe(failedSettlement.id);
    expect(world.planAction(world.repo, ACTION_1)).toBe("done");
    expect(world.planAction(world.repo, ACTION_2)).toBe("done");
    expect(withReadOnlyDatabase(world.workspace, (db) => listReviewRepairs(db, world.actionKey(ACTION_1))).map((row) => [row.round, row.outcome]))
      .toEqual([[1, "launched"]]);
  });

  it("leaves nothing for the operator", () => {
    expect(world.escalations()).toEqual([]);
    expect(world.redAlerts()).toEqual([]);
    expect(world.sessions().map((session) => session.action_id)).toEqual([ACTION_1, ACTION_1, ACTION_2]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});

describe("three failed repair rounds: one escalation naming the findings, nothing more launched", () => {
  let world: FastRehearsal;
  let status: ReturnType<FastRehearsal["productionStatus"]>;
  let report: ScenarioReport;
  const heads: string[] = [];
  beforeAll(() => {
    world = new FastRehearsal("review-repair-rounds-exhausted", isolation, import.meta.filename);
    worlds.push(world);
    world.expectError(/independent_verdict_failed|review_repair_rounds_exhausted|code-review: failed|verdict on [0-9a-f]+ (is fail|failed)|repair rounds/);
    world.github.failCriteria = ["correctness"];
    world.github.verdict = (role) => (role === "code-review" ? "fail" : "pass");
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    heads.push(world.execute(first.launch, ACTION_1).finalHead);
    for (const round of [1, 2, 3]) {
      const repair = untilRepairLaunched(world, round);
      heads.push(world.execute(repair.launch, ACTION_1, "clean", repairWork(round)).finalHead);
    }
    world.tickUntil(() => world.escalations().some((e) => e.kind === "review_repair_rounds_exhausted"), 10);
    world.ticks(3);
    world.advanceClock(3 * 3_600_000);
    world.ticks(3);
    status = world.productionStatus();
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("launched exactly three repairs, then nothing", () => {
    expect(world.sessions().map((session) => session.action_id)).toEqual([ACTION_1, ACTION_1, ACTION_1, ACTION_1]);
    expect(world.tmux.launches).toHaveLength(4);
    expect(world.lease()).toBeNull();
    expect(world.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review", "code-review", "code-review", "code-review"]);
    expect(withReadOnlyDatabase(world.workspace, (db) => listReviewRepairs(db, world.actionKey(ACTION_1))).map((row) => row.outcome))
      .toEqual(["launched", "launched", "launched", "escalated"]);
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
    expect(world.github.mergeCalls).toEqual([]);
  });

  it("escalates once, naming the findings, and says so on the last failed PR", () => {
    const key = world.actionKey(ACTION_1);
    expect(status.data.operatorEscalations.map((e) => [e.actionKey, e.kind])).toEqual([[key, "review_repair_rounds_exhausted"]]);
    expect(status.data.operatorEscalations[0].message).toContain("1. [blocker] Defect");
    expect(status.data.operatorEscalations[0].remedy).toContain("--rerun");
    expect(world.log.filter((line) => line.includes("Escalated") && line.includes("(review_repair_rounds_exhausted)"))).toHaveLength(1);
    // One comment and one return-to-draft per failed head.
    const verdictComments = world.github.comments.filter((comment) => comment.body.startsWith("Arcadia worker:"));
    expect(verdictComments).toHaveLength(4);
    expect(world.github.undoReadyCalls).toHaveLength(4);
    expect(verdictComments.map((comment) => /round (\d) of 3/.exec(comment.body)?.[1] ?? "escalated")).toEqual(["1", "2", "3", "escalated"]);
    expect(verdictComments[3].body).toContain("Do not merge: escalated to the operator.");
    for (const [index, head] of heads.entries()) expect(verdictComments[index].body).toContain(head);
    expect(world.gh.prs.every((pr) => pr.isDraft)).toBe(true);
    // Each failed PR a later repair superseded is closed; the last one stays open as a draft for the operator.
    expect(world.gh.prs.map((pr) => pr.state ?? "OPEN")).toEqual(["CLOSED", "CLOSED", "CLOSED", "OPEN"]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});

describe("main moves mid-run under the worker pull-request merge opt-in: the candidate still integrates", () => {
  let world: FastRehearsal;
  let one: ExecutorResult;
  let movedMain = "";
  let report: ScenarioReport;
  beforeAll(() => {
    world = new FastRehearsal("worker-merge-main-moved", isolation, import.meta.filename, { workerMerge: true });
    worlds.push(world);
    world.start();
    const first = world.untilLaunched(ACTION_1, 3);
    one = world.execute(first.launch, ACTION_1);
    // Another PR lands on main while the candidate is in flight: published, then synced locally.
    git(world.repo, ["commit", "-q", "--allow-empty", "-m", "Another pull request merged during the run"]);
    movedMain = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();
    git(world.repo, ["push", "-q", world.github.origin, "refs/heads/main:refs/heads/main"]);
    world.untilIntegrated(ACTION_1, 12);
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("merges the PR through GitHub at its exact reviewed head although main no longer fast-forwards to it", () => {
    expect(() => git(world.repo, ["merge-base", "--is-ancestor", movedMain, one.finalHead])).toThrow();
    const merges = world.github.mergeCalls;
    expect(merges.map((call) => call.merged)).toEqual([true]);
    expect(merges[0].matchHead).toBe(one.finalHead);
    git(world.repo, ["merge-base", "--is-ancestor", movedMain, "refs/heads/main"]);
    git(world.repo, ["merge-base", "--is-ancestor", one.finalHead, "refs/heads/main"]);
    expect(world.planAction(world.repo, ACTION_1)).toBe("done");
    expect(world.escalations()).toEqual([]);
    expect(world.log.some((line) => /cannot fast-forward/.test(line))).toBe(false);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});
