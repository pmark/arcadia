import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../../src/db/connection.js";
import { listReviewRepairs } from "../../src/sessions/reviewRepair.js";
import { requirementForSession } from "../../src/sessions/roleLineage.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ScenarioReport } from "./helpers/report.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * A failed verdict judged under an outdated deterministic judgement (live
 * 2026-10-19: repair PR #1554's code review failed partly on the Not-applicable
 * claims check computed before PR #1563 fixed it; its repair stayed gated
 * authority-adjacent forever, because the tick never re-runs a real failed
 * verdict). JUDGEMENT_REVISION is now hashed into every verdict's criteria
 * binding, so a verdict judged under an earlier revision is no longer current
 * and the existing readiness path re-reviews the head on the next Active tick,
 * while a current-revision failure still stops. Real worker tick, review
 * commands and repair loop; only the reviewer model, GitHub, tmux and the
 * agent are faked.
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

/** A failed code review that judges Security and authority fail: authority-adjacent, so the repair is gated, as on #1554. */
function failGated(world: FastRehearsal, failing: { on: boolean }): void {
  world.expectError(/independent_verdict_failed|review_repair_gated|code-review: failed|verdict on [0-9a-f]+ (is fail|failed)|authority-adjacent/);
  world.github.failCriteria = ["security-and-authority"];
  world.github.verdict = (role) => (role === "code-review" && failing.on ? "fail" : "pass");
  world.start();
}

const gatedRepairs = (world: FastRehearsal) =>
  withReadOnlyDatabase(world.workspace, (db) => listReviewRepairs(db, world.actionKey(ACTION_1))).map((row) => row.outcome);
const codeReviewAttempts = (world: FastRehearsal) =>
  world.attempts(ACTION_1).filter((attempt) => attempt.role === "code-review").map((attempt) => attempt.status);

describe("a failed verdict judged under an older judgement revision: re-reviewed on the next tick, then integrated", () => {
  let world: FastRehearsal;
  let failedHead = "";
  let draftedBeforeRereview = false;
  let reviewerCallsBeforeRereview = 0;
  let escalationsAfterPass: string[] = [];
  let report: ScenarioReport;
  const failing = { on: true };
  beforeAll(() => {
    world = new FastRehearsal("judgement-revision-superseded-rereview", isolation, import.meta.filename);
    worlds.push(world);
    failGated(world, failing);
    const first = world.untilLaunched(ACTION_1, 3);
    failedHead = world.execute(first.launch, ACTION_1).finalHead;
    world.tickUntil(() => world.escalations().some((escalation) => escalation.kind === "review_repair_gated"), 12);
    world.ticks(2);
    draftedBeforeRereview = world.gh.prs.every((pr) => pr.isDraft);
    reviewerCallsBeforeRereview = world.github.reviewerCalls.length;
    // The recorded verdict was judged before the current judgement revision
    // (as #1554's was): bound to the bare acceptance-criteria fingerprint,
    // exactly what every verdict before JUDGEMENT_REVISION existed recorded.
    withDatabase(world.workspace, (db) => {
      const requirement = requirementForSession(world.repo, first.session)!;
      db.prepare("UPDATE session_role_attempts SET criteria_fingerprint = ? WHERE role = 'code-review' AND status = 'failed'")
        .run(requirement.criteriaFingerprint);
    });
    failing.on = false;
    world.untilIntegrated(ACTION_1, 12);
    escalationsAfterPass = world.escalations().map((escalation) => escalation.kind);
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("first stopped exactly as live: one code review, PR returned to draft, repair gated", () => {
    expect(reviewerCallsBeforeRereview).toBe(1);
    expect(draftedBeforeRereview).toBe(true);
    expect(gatedRepairs(world)).toEqual(["gated"]);
  });

  it("re-runs the code review once on the same head, re-readying the PR the worker had drafted, then QA", () => {
    const calls = world.github.reviewerCalls.map((call) => [call.role, call.head === failedHead ? "failed-head" : call.head]);
    expect(calls).toEqual([["code-review", "failed-head"], ["code-review", "failed-head"], ["qa", "failed-head"]]);
    const pr = world.gh.prs[0];
    expect(world.github.readyCalls.filter((url) => url === pr.url)).toHaveLength(2);
    expect(codeReviewAttempts(world)).toEqual(["failed", "passed"]);
  });

  it("integrates the same head with no repair Session launched", () => {
    expect(git(world.repo, ["rev-list", "refs/heads/main"]).split("\n")).toContain(failedHead);
    expect(world.sessions().map((session) => session.action_id)).toEqual([ACTION_1]);
    expect(world.tmux.launches).toHaveLength(1);
    // The gated repair's escalation named a verdict that no longer stands.
    expect(escalationsAfterPass).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});

describe("a failed verdict judged under the current judgement revision: never re-reviewed", () => {
  let world: FastRehearsal;
  let report: ScenarioReport;
  beforeAll(() => {
    world = new FastRehearsal("judgement-revision-current-no-rereview", isolation, import.meta.filename);
    worlds.push(world);
    failGated(world, { on: true });
    const first = world.untilLaunched(ACTION_1, 3);
    world.execute(first.launch, ACTION_1);
    world.tickUntil(() => world.escalations().some((escalation) => escalation.kind === "review_repair_gated"), 12);
    world.ticks(5);
    report = world.finish();
  }, SCENARIO_TIMEOUT_MS);

  it("keeps the one failed verdict, the draft and the gated repair; nothing integrates", () => {
    expect(world.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review"]);
    expect(codeReviewAttempts(world)).toEqual(["failed"]);
    expect(world.gh.prs.every((pr) => pr.isDraft)).toBe(true);
    expect(world.github.readyCalls).toHaveLength(1);
    expect(gatedRepairs(world)).toEqual(["gated"]);
    expect(world.planAction(world.repo, ACTION_1)).toBe("open");
    expect(world.tmux.launches).toHaveLength(1);
    expect(report.errors.filter((error) => !error.expected)).toEqual([]);
  });
});
