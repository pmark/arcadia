import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { attemptAutoSettlePendingCompletion, AUTO_SETTLE_NO_DRAFT } from "../src/ask/autoSettleBeforeDispatch.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { PRODUCTION_CONTROL_DEADLINES, readProductionPolicySafely } from "../src/production/policy.js";
import { getProductionRepairAttempts } from "../src/production/tick.js";
import { ESCALATION_REMEDIES } from "../src/production/blockerRemedies.js";
import { candidateChangeGate, renderFailedVerdictComment, testWeakeningGates, unrepairableReason, verdictIsAuthorityAdjacent, verdictIsRepairable } from "../src/production/reviewRepair.js";
import { listPendingTerminalCandidates } from "../src/production/terminalCandidates.js";
import type { AgentSession } from "../src/sessions/index.js";
import { ensureReviewRepairTable, getSessionRepair, launchedRepairRounds, listReviewRepairs, releaseRepairSession, type ReviewRepairRow } from "../src/sessions/reviewRepair.js";
import { getSession } from "../src/sessions/index.js";
import { beginDevelopmentAttempt, beginIndependentVerdict, finishIndependentVerdict, independentVerdictReadiness, planDevelopmentAttempt } from "../src/sessions/roleLineage.js";
import { git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * The production worker's review repair loop (src/production/reviewRepair.ts),
 * driven by the real worker tick over the shared rehearsal fixture: a real
 * failed verdict returns the PR to draft with one comment and launches one
 * bounded repair Session for the same Action, or stops once for the operator.
 */
const rehearsals: Rehearsal[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];

/** Action A finished, preserved, readied and its code review failed; returns the failed Session after the tick that recorded the verdict. */
function failedReview(setup: (rehearsal: Rehearsal) => void = () => {}, edits: Record<string, string> = {}, finish: "settled" | "sandboxed" = "settled"): { rehearsal: Rehearsal; a: AgentSession; head: string } {
  const rehearsal = new Rehearsal({ independentReviewers: "tick" });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  const a = rehearsal.lease()!;
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  for (const [file, content] of Object.entries(edits)) rehearsal.agentEdit(a, file, content);
  if (finish === "settled") rehearsal.agentFinish(a, CRITERIA_A);
  else rehearsal.agentFinishSandboxed(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  rehearsal.github.verdict = (role, pr) => (role === "code-review" && pr?.branch === a.branch ? "fail" : "pass");
  // A correctness defect; a failed authority criterion is a gate (tested below).
  rehearsal.github.failCriteria = ["correctness"];
  setup(rehearsal);
  expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion"); // exit tick: preserved behind a draft PR
  rehearsal.tick(); // ready
  rehearsal.tick(); // code review fails; the repair step runs in this same tick
  return { rehearsal, a, head: git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim() };
}

const exitReceiptOf = (rehearsal: Rehearsal, sessionId: string) => withReadOnlyDatabase(rehearsal.workspace, (db) =>
  db.prepare("SELECT outcome, superseded_by_session_id FROM session_exit_receipts WHERE session_id = ?").get(sessionId) as { outcome: string; superseded_by_session_id: string | null });
const repairs = (rehearsal: Rehearsal) => withReadOnlyDatabase(rehearsal.workspace, (db) => listReviewRepairs(db, rehearsal.actionA));
const escalation = (rehearsal: Rehearsal) => rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA);

describe("the review repair trigger", () => {
  it("returns the failed PR to draft, comments once and launches one repair Session for the same Action with the findings in its brief", () => {
    const { rehearsal, a, head } = failedReview();
    const repair = rehearsal.lease()!;
    expect(repair.id).not.toBe(a.id);
    expect(repair.action_id).toBe(a.action_id);
    expect(repair.branch).not.toBe(a.branch);
    expect(repair.base_revision).toBe(a.base_revision);
    expect(repair.launch_revision).toBe(git(rehearsal.repo, ["rev-parse", `${head}^`]).trim());
    expect(git(repair.worktree_path, ["rev-parse", "HEAD"]).trim()).toBe(repair.launch_revision);
    const pr = rehearsal.github.prs[0];
    expect(pr.isDraft).toBe(true);
    expect(rehearsal.github.undoReadyCalls).toEqual([pr.url]);
    expect(rehearsal.github.comments).toHaveLength(1);
    expect(rehearsal.github.comments[0].body).toContain("Do not merge: the repair loop will push a fixed head (round 1 of 3)");
    const brief = rehearsal.tmux.launches.at(-1)!.args.at(-1)!;
    expect(brief).toContain("repair round 1 of 3");
    expect(brief).toContain("1. [blocker] Defect");
    expect(repairs(rehearsal).map((row) => [row.round, row.outcome, row.repair_session_id])).toEqual([[1, "launched", repair.id]]);
    // The verdict escalation is withdrawn: the repair owns the Action now.
    expect(escalation(rehearsal)).toBeUndefined();
    // The failed candidate no longer claims terminal recovery.
    const pending = withReadOnlyDatabase(rehearsal.workspace, (db) => listPendingTerminalCandidates(db, rehearsal.repo, rehearsal.projectSlug));
    expect(pending?.pending.map((session) => session.id) ?? []).not.toContain(a.id);
    // Later ticks repeat nothing while the repair runs.
    rehearsal.tick();
    rehearsal.tick();
    expect(rehearsal.github.comments).toHaveLength(1);
    expect(rehearsal.tmux.launches).toHaveLength(2);
  });

  it("gives the failed candidate back to terminal recovery when its repair Session is abandoned before it starts", () => {
    const { rehearsal, a } = failedReview();
    const repair = rehearsal.lease()!;
    const row = repairs(rehearsal)[0];
    withDatabase(rehearsal.workspace, (db) => releaseRepairSession(db, { requestId: row.request_id, sessionId: repair.id, now: rehearsal.now }));
    const pending = withReadOnlyDatabase(rehearsal.workspace, (db) => listPendingTerminalCandidates(db, rehearsal.repo, rehearsal.projectSlug));
    expect(pending?.pending.map((session) => session.id)).toContain(a.id);
    expect(repairs(rehearsal).map((r) => [r.outcome, r.repair_session_id])).toEqual([["pending", null]]);
  });
});

describe("the inherited completion draft and a resumed repair", () => {
  it("retires the failed candidate's own draft before the repair starts, and a resumed repair keeps its findings and settles only its own Ask", () => {
    const { rehearsal, a, head } = failedReview(() => {}, {}, "sandboxed");
    const repair = rehearsal.lease()!;
    expect(repair.id).not.toBe(a.id);
    const start = git(rehearsal.repo, ["rev-parse", `${head}^`]).trim();
    const inherited = git(rehearsal.repo, ["ls-tree", "-r", "--name-only", start, "--", ".arcadia/asks/"]).split("\n").filter((file) => file && !file.includes("/archive/"));
    expect(inherited.length).toBeGreaterThan(0);
    // One host commit retired it; the agent starts after it.
    expect(git(repair.worktree_path, ["rev-parse", "HEAD^"]).trim()).toBe(start);
    expect(repair.launch_revision).toBe(git(repair.worktree_path, ["rev-parse", "HEAD"]).trim());
    expect(git(repair.worktree_path, ["log", "-1", "--format=%s"]).trim()).toMatch(/retire the failed candidate's completion draft/);
    // Under the standing host identity, never the ambient one.
    expect(git(repair.worktree_path, ["log", "-1", "--format=%an <%ae> / %cn <%ce>"]).trim())
      .toBe("Arcadia Controller <controller@arcadia.local> / Arcadia Controller <controller@arcadia.local>");
    for (const file of inherited) expect(git(repair.worktree_path, ["ls-files", "--", file]).trim()).toBe("");
    // The repair agent works, then dies before finishing: a resumable exit.
    rehearsal.agentEdit(repair, "REPAIR.md", "partial fix\n");
    rehearsal.tmux.exit(repair.tmux_session_name);
    rehearsal.tickUntil(() => {
      const lease = rehearsal.lease();
      return lease !== null && lease.id !== repair.id;
    }, 4);
    const resumed = rehearsal.lease()!;
    expect(resumed.worktree_path).toBe(repair.worktree_path);
    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => getSessionRepair(db, resumed.id))?.request_id).toBe(repairs(rehearsal)[0].request_id);
    const brief = rehearsal.tmux.launches.at(-1)!.args.at(-1)!;
    expect(brief).toContain("repair round 1 of 3");
    expect(brief).toContain("1. [blocker] Defect");
    // The resumed repair drafts its own completion from inside its sandbox; the host settles that one.
    rehearsal.agentFinishSandboxed(resumed, CRITERIA_A);
    rehearsal.tmux.exit(resumed.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
  });
});

describe("the review repair bound and gates", () => {
  it("escalates once, naming the findings, after the run's three repair rounds are spent, and launches nothing", () => {
    const { rehearsal, head } = failedReview((r) => {
      withDatabase(r.workspace, (db) => {
        ensureReviewRepairTable(db);
        const epoch = (readProductionPolicySafely(db) as { policy: { epoch: number } }).policy.epoch;
        for (const round of [1, 2, 3]) {
          db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
            start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome,
            created_at, updated_at) VALUES (?, ?, ?, ?, 's', 'b', 'h', 'r', NULL, 'code-review', 'fail', 'x', NULL, '[]', '[]', ?, 'launched', ?, ?)`)
            .run(`earlier-${round}`, r.actionA, epoch, round, `earlier-session-${round}`, r.now.toISOString(), r.now.toISOString());
        }
      });
    });
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.tmux.launches).toHaveLength(1);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_rounds_exhausted", message: expect.stringContaining("1. [blocker] Defect") });
    expect(rehearsal.github.comments).toHaveLength(1);
    expect(rehearsal.github.comments[0].body).toContain(head);
    expect(rehearsal.github.comments[0].body).toContain("Do not merge: escalated to the operator.");
    for (let i = 0; i < 4; i += 1) rehearsal.tick();
    expect(rehearsal.github.comments).toHaveLength(1);
    expect(rehearsal.github.undoReadyCalls).toHaveLength(1);
    expect(rehearsal.tmux.launches).toHaveLength(1);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_rounds_exhausted" });
    expect(rehearsal.log.filter((line) => line.includes("(review_repair_rounds_exhausted)"))).toHaveLength(1);
  });

  it("stops for the operator on an authority-adjacent verdict", () => {
    const { rehearsal } = failedReview((r) => { r.github.findingTitle = "Broadens the worker's merge authority"; });
    expect(rehearsal.lease()).toBeNull();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("authority-adjacent") });
    expect(rehearsal.github.prs[0].isDraft).toBe(true);
    expect(rehearsal.github.comments[0].body).toContain("Do not merge: escalated to the operator.");
  });

  // The live verdict on PR #1545 (2026-10-18): the deterministic gate's refused
  // not-applicable finding lists the criterion names it refused, here including
  // "Security and authority". A refused not-applicable claim on an authority
  // criterion is never repaired unattended (prReview's VARIANCE_EXCLUDED_CRITERIA).
  const REFUSED_TITLE = "Refused not-applicable claim: Failure handling, State and concurrency, Security and authority, Compatibility, Tests";

  it("stops for the operator on the live title: a refused not-applicable claim on Security and authority gates", () => {
    const { rehearsal } = failedReview((r) => { r.github.findingTitle = REFUSED_TITLE; });
    expect(rehearsal.lease()).toBeNull();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("Security and authority") });
  });

  it("stops for the operator when the candidate's own changes touch the checked-in gate list", () => {
    const { rehearsal } = failedReview(() => {}, { ".github/workflows/ci.yml": "name: ci\n" });
    expect(rehearsal.lease()).toBeNull();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("ci_and_gates") });
  });

  it("stops for the operator when Correctness and the Security-and-authority criterion fail together", () => {
    const { rehearsal } = failedReview((r) => { r.github.failCriteria = null; });
    expect(rehearsal.lease()).toBeNull();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("Security and authority") });
  });

  it("stops for the operator when the candidate changes launch-authority code", () => {
    const { rehearsal } = failedReview(() => {}, { "src/sessions/launch.ts": "export {};\n" });
    expect(rehearsal.lease()).toBeNull();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("src/sessions/launch.ts") });
  });

  it("stops for the operator when the candidate adds a skipped test", () => {
    const { rehearsal } = failedReview(() => {}, { "tests/marker.test.mjs": "import { it } from \"node:test\";\nit.skip(\"marker\", () => {});\n" });
    expect(rehearsal.lease()).toBeNull();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("skipped or focused test") });
  });

  it("stops for the operator, unreviewed, when a repair Session deletes the test the reviewer complained about", () => {
    const { rehearsal } = failedReview(() => {}, { "tests/marker.test.mjs": "import { test } from \"node:test\";\ntest(\"marker\", () => {});\n" });
    const repair = rehearsal.lease()!;
    rmSync(path.join(repair.worktree_path, "tests", "marker.test.mjs"));
    rehearsal.agentFinish(repair, CRITERIA_A);
    rehearsal.tmux.exit(repair.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion"); // exit tick: the repair's own draft PR
    const reviewersBefore = rehearsal.github.reviewerCalls.length;
    for (let i = 0; i < 4; i += 1) expect(rehearsal.tick().handoff?.integration.kind).not.toBe("integrated");
    expect(rehearsal.github.reviewerCalls.length).toBe(reviewersBefore);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("deletes test files (tests/marker.test.mjs)") });
    const repairPr = rehearsal.github.prs.find((pr) => pr.branch === repair.branch)!;
    expect(repairPr.isDraft).toBe(true);
    expect(rehearsal.github.readyCalls).not.toContain(repairPr.url);
    expect(rehearsal.github.comments.filter((comment) => comment.url === repairPr.url).map((comment) => comment.body)).toEqual([
      expect.stringContaining("Do not merge: escalated to the operator.")
    ]);
    expect(rehearsal.tmux.launches).toHaveLength(2);
    expect(rehearsal.log.filter((line) => line.includes("(review_repair_gated)"))).toHaveLength(1);
  });

  it("bounds the gated repair candidate's draft/comment retries like the repair step's own", () => {
    const { rehearsal } = failedReview(() => {}, { "tests/marker.test.mjs": "import { test } from \"node:test\";\ntest(\"marker\", () => {});\n" });
    const repair = rehearsal.lease()!;
    rmSync(path.join(repair.worktree_path, "tests", "marker.test.mjs"));
    rehearsal.agentFinish(repair, CRITERIA_A);
    rehearsal.tmux.exit(repair.tmux_session_name);
    rehearsal.github.commentFailures.push(...Array.from({ length: 20 }, () => "HTTP 502 (simulated)"));
    for (let i = 0; i < 9; i += 1) rehearsal.tick();
    const gateRow = repairs(rehearsal).find((row) => row.role === "repair-gate")!;
    expect(gateRow).toMatchObject({ outcome: "gated", notify_failures: 5, last_error: expect.stringContaining("HTTP 502") });
    const repairPr = rehearsal.github.prs.find((pr) => pr.branch === repair.branch)!;
    expect(rehearsal.github.ghCalls.filter((call) => call.startsWith(`gh pr comment ${repairPr.url}`))).toHaveLength(5);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated" });
  });

  it("never launches a repair once a rerun on the same head passed while the repair was pending, and releases the row", () => {
    const { rehearsal, a, head } = failedReview((r) => { r.github.commentFailures.push("HTTP 502 (simulated)"); });
    expect(rehearsal.lease()).toBeNull(); // held back by the failed comment: the row is pending
    expect(repairs(rehearsal).map((row) => row.outcome)).toEqual(["pending"]);
    // An operator judges the verdict wrong and reruns the code review on the same head: it passes.
    withDatabase(rehearsal.workspace, (db) => {
      const session = getSession(db, a.id)!;
      const requestId = "code-review-operator-rerun-0001";
      const actorId = "code-review-reviewer:operator-rerun";
      beginIndependentVerdict(db, { role: "code-review", session, repoRoot: rehearsal.repo, requestId, actorId, executionCwd: rehearsal.workspace, retryAuthorized: true, now: rehearsal.now });
      finishIndependentVerdict(db, { requestId, actorId, session, repoRoot: rehearsal.repo, verdict: "passed", receipt: { reviewer: actorId }, now: rehearsal.now });
    });
    for (let i = 0; i < 4; i += 1) rehearsal.tick();
    expect(rehearsal.tmux.launches).toHaveLength(1);
    expect(exitReceiptOf(rehearsal, a.id)).toMatchObject({ superseded_by_session_id: null });
    expect(repairs(rehearsal).map((row) => [row.failed_head, row.outcome])).toEqual([[head, "released"]]);
  });

  it("re-judges a pending repair's round under a new production epoch before launching it", () => {
    const { rehearsal } = failedReview((r) => { r.github.commentFailures.push("HTTP 502 (simulated)"); });
    const epoch = withReadOnlyDatabase(rehearsal.workspace, (db) => (readProductionPolicySafely(db) as { policy: { epoch: number } }).policy.epoch);
    withDatabase(rehearsal.workspace, (db) => {
      // The row was decided under an earlier run; this run already spent its three rounds.
      db.prepare("UPDATE production_review_repairs SET policy_epoch = ?, round = 1").run(epoch - 1);
      for (const round of [1, 2, 3]) {
        db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
          start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome,
          created_at, updated_at) VALUES (?, ?, ?, ?, 's', 'b', 'h', 'r', NULL, 'code-review', 'fail', 'x', NULL, '[]', '[]', ?, 'launched', ?, ?)`)
          .run(`this-run-${round}`, rehearsal.actionA, epoch, round, `this-run-session-${round}`, rehearsal.now.toISOString(), rehearsal.now.toISOString());
      }
    });
    rehearsal.tick();
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.tmux.launches).toHaveLength(1);
    const row = repairs(rehearsal).find((entry) => entry.repair_session_id === null)!;
    expect(row).toMatchObject({ outcome: "escalated", policy_epoch: epoch });
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_rounds_exhausted" });
  });

  it("gates a drafted failed PR that was closed before the repair launches", () => {
    const { rehearsal } = failedReview((r) => { r.github.commentFailures.push("HTTP 502 (simulated)"); });
    expect(repairs(rehearsal)[0].drafted_at).not.toBeNull();
    rehearsal.github.prs[0].state = "CLOSED";
    rehearsal.tick();
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.tmux.launches).toHaveLength(1);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("no longer open") });
  });

  it("launches the same repair after one spawn failure: one row, one round, budget reset, the unstarted attempt set aside", () => {
    let failures = 1;
    const { rehearsal } = failedReview((r) => {
      const launch = r.tmux.launch.bind(r.tmux);
      r.tmux.launch = (input) => {
        if (failures-- > 0) throw new Error("tmux could not start the Session (simulated)");
        launch(input);
      };
    });
    expect(rehearsal.lease()).toBeNull();
    rehearsal.tick();
    const repair = rehearsal.lease()!;
    expect(repair).not.toBeNull();
    const rows = repairs(rehearsal);
    expect(rows.map((row) => [row.outcome, row.repair_session_id])).toEqual([["launched", repair.id]]);
    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => launchedRepairRounds(db, rehearsal.actionA, rows[0].policy_epoch))).toBe(1);
    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => getProductionRepairAttempts(db, rehearsal.actionA)).attempts).toBe(0);
    const development = rehearsal.attempts("write-marker-a").filter((x) => x.role === "development");
    expect(development.map((x) => x.status)).toEqual(["passed", "failed", expect.stringMatching(/pending|running/)]);
    expect(JSON.parse(development[1].terminal_receipt_json!)).toMatchObject({ repairNeverStarted: true });
    expect(rehearsal.log.some((line) => line.includes("mutation_owner_active"))).toBe(false);
  });

  it("reads no PR state for a launch the repair budget already forbids", () => {
    const { rehearsal } = failedReview((r) => {
      r.tmux.launch = () => { throw new Error("tmux could not start the Session (simulated)"); };
    });
    for (let i = 0; i < 4; i += 1) rehearsal.tick();
    expect(escalation(rehearsal)).toMatchObject({ kind: "repair_budget_exhausted" });
    const stateReads = () => rehearsal.github.ghCalls.filter((call) => /^gh pr view \S+ --json state$/.test(call)).length;
    const before = stateReads();
    for (let i = 0; i < 3; i += 1) rehearsal.tick();
    expect(stateReads()).toBe(before);
  });

  it("stops for the operator when the pre-launch PR state read keeps failing", () => {
    const { rehearsal } = failedReview((r) => {
      const github = r.github as unknown as { runCommand: typeof r.github.runCommand };
      const original = github.runCommand;
      github.runCommand = (input) => input.command === "gh" && input.args[0] === "pr" && input.args[1] === "view" && input.args.at(-1) === "state"
        ? { status: 1, stdout: "", stderr: "HTTP 502 (simulated)", error: null }
        : original(input);
    });
    for (let i = 0; i < 6; i += 1) rehearsal.tick();
    expect(rehearsal.lease()).toBeNull();
    expect(repairs(rehearsal).map((row) => [row.outcome, row.notify_failures])).toEqual([["gated", 5]]);
    expect(repairs(rehearsal)[0].last_error).toContain("HTTP 502");
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("could not be read") });
  });

  it("after a repair spawn failure, an ordinary development launch is refused over the passed candidate; only the retried repair allocates", () => {
    let failures = 1;
    const { rehearsal, a } = failedReview((r) => {
      const launch = r.tmux.launch.bind(r.tmux);
      r.tmux.launch = (input) => {
        if (failures-- > 0) throw new Error("tmux could not start the Session (simulated)");
        launch(input);
      };
    });
    const development = () => rehearsal.attempts("write-marker-a").filter((x) => x.role === "development");
    expect(development().map((x) => x.status)).toEqual(["passed", "failed"]);
    withDatabase(rehearsal.workspace, (db) => {
      const readiness = independentVerdictReadiness(db, { session: getSession(db, a.id)!, repoRoot: rehearsal.repo });
      const requirement = readiness.requirement!;
      expect(() => planDevelopmentAttempt(db, { requirement, retryAuthorized: true }))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "attempt_retry_not_authorized" }) }));
      expect(() => beginDevelopmentAttempt(db, { requirement, requestId: "plain-operator-launch-0001", retryAuthorized: true, now: rehearsal.now }))
        .toThrow(expect.objectContaining({ details: expect.objectContaining({ code: "attempt_retry_not_authorized" }) }));
    });
    expect(development()).toHaveLength(2);
    rehearsal.tick();
    expect(rehearsal.lease()).not.toBeNull();
    expect(development().map((x) => x.status)).toEqual(["passed", "failed", expect.stringMatching(/pending|running/)]);
  });

  it("never marks a repair never-started, or removes its worktree, when the failure came after the Session spawned", () => {
    const { rehearsal } = failedReview((r) => {
      const launch = r.tmux.launch.bind(r.tmux);
      let failed = false;
      r.tmux.launch = (input) => {
        launch(input); // the process is running
        if (!failed) { failed = true; throw new Error("SQLITE_BUSY: database is locked (simulated, after spawn)"); }
      };
    });
    const repairSession = rehearsal.sessions().at(-1)!;
    expect(repairSession.id).not.toBe(rehearsal.sessions()[0].id);
    expect(existsSync(repairSession.worktree_path)).toBe(true);
    const development = rehearsal.attempts("write-marker-a").filter((x) => x.role === "development");
    expect(development.some((x) => x.terminal_receipt_json?.includes("repairNeverStarted"))).toBe(false);
    expect(repairs(rehearsal).map((row) => row.repair_session_id)).toEqual([repairSession.id]);
  });

  it("stops a repeating non-conflict repair launch failure at the per-Action repair budget with one escalation", () => {
    let spawns = 0;
    const { rehearsal } = failedReview((r) => {
      r.tmux.launch = () => { spawns += 1; throw new Error("tmux could not start the Session (simulated)"); };
    });
    for (let i = 0; i < 6; i += 1) rehearsal.tick();
    expect(rehearsal.lease()).toBeNull();
    expect(spawns).toBe(PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction);
    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => getProductionRepairAttempts(db, rehearsal.actionA)).attempts)
      .toBe(PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction);
    expect(escalation(rehearsal)).toMatchObject({ kind: "repair_budget_exhausted" });
    expect(rehearsal.log.filter((line) => line.includes("(repair_budget_exhausted)"))).toHaveLength(1);
    // Each failed attempt left no repair worktree or branch behind.
    expect(rehearsal.sessions().filter((s) => s.status === "running" || s.status === "prepared")).toEqual([]);
  });

  it("escalates instead of launching when no verdict attempt is left to review a repaired head", () => {
    const { rehearsal } = failedReview((r) => { r.github.commentFailures.push("HTTP 502 (simulated)"); });
    expect(rehearsal.lease()).toBeNull(); // held back by the failed comment
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE session_role_attempts SET ordinal = 5 WHERE role = 'code-review'").run());
    rehearsal.tick();
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.tmux.launches).toHaveLength(1);
    expect(repairs(rehearsal).map((row) => row.outcome)).toEqual(["escalated"]);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_rounds_exhausted", message: expect.stringContaining("No independent code-review attempt remains") });
    expect(rehearsal.github.comments.at(-1)?.body).toContain("Do not merge: escalated to the operator.");
  });

  it("treats a failed PR that is no longer open as a gated stop, and names a merge", () => {
    const { rehearsal } = failedReview((r) => {
      r.github.beforeReady = null;
      r.github.commentFailures.push("HTTP 502 (simulated)");
    });
    // The draft already happened on the failing tick; simulate a person merging it before the next one.
    rehearsal.github.prs[0].state = "MERGED";
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE production_review_repairs SET drafted_at = NULL").run());
    rehearsal.tick();
    expect(rehearsal.lease()).toBeNull();
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("was MERGED although") });
  });

  it("stops for the operator after the draft or comment keeps failing", () => {
    const { rehearsal } = failedReview((r) => { r.github.commentFailures.push(...Array.from({ length: 8 }, () => "HTTP 502 (simulated)")); });
    for (let i = 0; i < 6; i += 1) rehearsal.tick();
    expect(rehearsal.lease()).toBeNull();
    expect(repairs(rehearsal).map((row) => [row.outcome, row.notify_failures])).toEqual([["gated", 5]]);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("after 5 attempts") });
  });

  it("retries a failed PR comment on the next tick, never posting it twice and launching only after it", () => {
    const { rehearsal } = failedReview((r) => { r.github.commentFailures.push("HTTP 502 (simulated)"); });
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.github.comments).toEqual([]);
    expect(rehearsal.github.undoReadyCalls).toHaveLength(1);
    rehearsal.tick();
    expect(rehearsal.github.comments).toHaveLength(1);
    expect(rehearsal.github.undoReadyCalls).toHaveLength(1);
    expect(rehearsal.lease()).not.toBeNull();
  });
});

describe("review repair pure parts", () => {
  it("flags every failed authority or approval criterion and authority findings, not a plain defect", () => {
    const finding = (title: string) => ({ severity: "blocker", title, evidence: "MARKER.md", recommendation: "Fix it." });
    const check = (name: string, status: string) => ({ name, status, evidence: "" });
    expect(verdictIsAuthorityAdjacent([finding("Defect")], [check("Correctness", "fail"), check("Security and authority", "pass")])).toBeNull();
    // Correctness failing too never excuses a failed authority criterion (Decision 0098).
    expect(verdictIsAuthorityAdjacent([finding("Defect")], [check("Correctness", "fail"), check("Security and authority", "fail")])).toMatch(/Security and authority/);
    expect(verdictIsAuthorityAdjacent([finding("Exposes a credential in logs")], [])).toMatch(/authority/);
    expect(verdictIsAuthorityAdjacent([], [check("Correctness", "pass"), check("Approval boundaries", "fail")])).toMatch(/Approval boundaries/);
  });

  // The deterministic finding exactly as src/qa/prReview.ts writes it.
  const refusedNA = (...names: string[]) => ({
    severity: "high",
    title: `Refused not-applicable claim: ${names.join(", ")}`,
    evidence: names.map((name) => `${name}: the patch touches files that can affect it`).join(" "),
    recommendation: "Judge each refused criterion pass or fail against the patch, or report it not-checked; not-applicable is accepted only for a criterion the change demonstrably cannot affect."
  });
  const naFailed = { name: "Not-applicable claims", status: "fail", evidence: "" };
  const crit = (name: string, status: string) => ({ name, status, evidence: "" });
  const missing = { severity: "medium", title: "Required #1512 failure/fix is absent from the report", evidence: "never cites #1512", recommendation: "Add the missing #1512 failure and its stated resolution." };

  it("gates a refused not-applicable claim on an authority criterion, whatever else failed beside it", () => {
    // The review's probe: an unrelated finding must not let a refused authority claim be repaired.
    expect(verdictIsAuthorityAdjacent([refusedNA("Security and authority"), { ...missing, title: "Typo in error message" }], [naFailed])).toMatch(/Security and authority/);
    expect(verdictIsAuthorityAdjacent([refusedNA("Approval boundaries"), missing], [naFailed])).toMatch(/Approval boundaries/);
    // The live PR #1545 verdict (review_ef65d2d07572489c90): its refused list includes Security and authority.
    expect(verdictIsAuthorityAdjacent([refusedNA("Failure handling", "State and concurrency", "Security and authority", "Compatibility", "Tests"), missing], [naFailed, crit("Correctness", "fail")])).toMatch(/Security and authority/);
    // A non-pass authority criterion gates, not-applicable included.
    expect(verdictIsAuthorityAdjacent([missing], [crit("Security and authority", "not-applicable")])).toMatch(/Security and authority/);
    expect(verdictIsAuthorityAdjacent([missing], [crit("Approval boundaries", "not-checked")])).toMatch(/Approval boundaries/);
    // A refused list naming no authority criterion is no authority flag.
    expect(verdictIsAuthorityAdjacent([refusedNA("Failure handling", "Compatibility", "Tests"), missing], [naFailed, crit("Correctness", "fail")])).toBeNull();
  });

  it("treats a reviewer-authored finding that only borrows the deterministic title as an ordinary finding", () => {
    const forged = { severity: "high", title: "Refused not-applicable claim: Tests, credential leak in logs", evidence: "x", recommendation: "Fix it." };
    expect(verdictIsAuthorityAdjacent([forged], [])).toMatch(/authority/);
    expect(verdictIsRepairable([forged], [])).toBe(true);
    // An unknown criterion name in an otherwise deterministic-looking finding is not deterministic either.
    expect(verdictIsAuthorityAdjacent([{ ...refusedNA("Tests"), title: "Refused not-applicable claim: Tests, credential leak" }], [])).toMatch(/authority/);
  });

  it("repairs only what a repair can change, and names why it cannot otherwise", () => {
    expect(verdictIsRepairable([refusedNA("Tests"), missing], [naFailed, crit("Correctness", "fail")])).toBe(true);
    expect(verdictIsRepairable([refusedNA("Tests")], [naFailed])).toBe(false);
    expect(verdictIsRepairable([refusedNA("Tests")], [naFailed, crit("Correctness", "fail")])).toBe(true);
    expect(unrepairableReason([refusedNA("Tests")], [naFailed])).toMatch(/refusing the reviewer's not-applicable claims/);
    // An empty or unreadable report, or a not-checked-only verdict, gets its own reason.
    expect(verdictIsRepairable([], [])).toBe(false);
    expect(unrepairableReason([], [])).not.toMatch(/not-applicable/);
    expect(unrepairableReason([], [crit("Tests", "not-checked")])).toMatch(/no reviewer finding or failed criterion/);
  });

  it("describes both repair escalations generally and points at the entry's reason and the PR's findings comment", () => {
    const exhausted = ESCALATION_REMEDIES.review_repair_rounds_exhausted.consequence;
    const gated = ESCALATION_REMEDIES.review_repair_gated.consequence;
    expect(exhausted).toMatch(/verdict attempt/);
    for (const text of ["authority", "launch", "test", "threshold", "no longer open", "comment", "repair candidate"]) expect(gated).toContain(text);
    for (const text of [exhausted, gated]) {
      expect(text).toMatch(/escalation entry/);
      expect(text).toMatch(/findings comment/);
    }
  });

  it("renders the comment's next step from the row's outcome", () => {
    const row = {
      request_id: "r", action_key: "p/a", policy_epoch: 1, round: 2, failed_session_id: "s", failed_branch: "b", failed_head: "abc123", start_revision: "def",
      pull_request_url: "u", role: "qa", verdict: "fail", summary: "A defect.", report_path: "artifacts/qa/x/qa-report.md",
      findings_json: JSON.stringify([{ severity: "high", title: "T", evidence: "E", recommendation: "R" }]), failed_checks_json: "[]",
      repair_session_id: null, outcome: "pending", reason: null, last_error: null, drafted_at: null, commented_at: null, closed_at: null, notify_failures: 0, created_at: "", updated_at: ""
    } satisfies ReviewRepairRow;
    expect(renderFailedVerdictComment(row)).toContain("round 2 of 3");
    expect(renderFailedVerdictComment(row)).toContain("1. [high] T");
    expect(renderFailedVerdictComment(row)).toContain("artifacts/qa/x/qa-report.md");
    expect(renderFailedVerdictComment({ ...row, outcome: "escalated" })).toContain("Do not merge: escalated to the operator.");
  });

  it("never settles a completion draft a repair Session inherited from the failed candidate", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-repair-draft-"));
    roots.push(root);
    git(root, ["init", "-q", "-b", "main"]);
    mkdirSync(path.join(root, ".arcadia", "asks"), { recursive: true });
    writeFileSync(path.join(root, ".arcadia", "asks", "agent-ask-old.yaml"), `${JSON.stringify({
      agent_ask: "v1", request_id: "complete-old", project: "p", intent: "complete", target_ref: "action/a", desired_result: "Done.",
      candidate_revision: "0000000", evidence: [{ criterion: "C", status: "met", note: "n" }], requested_authority: "apply_if_approved"
    })}\n`);
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "inherited"]);
    const start = git(root, ["rev-parse", "HEAD"]).trim();
    const result = attemptAutoSettlePendingCompletion({} as Database.Database, {
      repoRoot: root, projectSlug: "p", activePlanSlug: "plan", action: { id: "a", acceptanceCriteria: ["C"] }, excludeDraftsAt: start
    });
    expect(result).toMatchObject({ settled: false, reason: AUTO_SETTLE_NO_DRAFT });
    // An edited copy still carries the failed candidate's request id: still excluded.
    writeFileSync(path.join(root, ".arcadia", "asks", "agent-ask-old.yaml"), `${JSON.stringify({
      agent_ask: "v1", request_id: "complete-old", project: "p", intent: "complete", target_ref: "action/a", desired_result: "Done, edited.",
      candidate_revision: start, evidence: [{ criterion: "C", status: "met", note: "edited" }], requested_authority: "apply_if_approved"
    })}\n`);
    expect(attemptAutoSettlePendingCompletion({} as Database.Database, {
      repoRoot: root, projectSlug: "p", activePlanSlug: "plan", action: { id: "a", acceptanceCriteria: ["C"] }, excludeDraftsAt: start
    })).toMatchObject({ settled: false, reason: AUTO_SETTLE_NO_DRAFT });
  });

  it("finds Decision 0098's test-weakening gates in the candidate's own change", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-repair-gates-"));
    roots.push(root);
    const commit = (message: string) => {
      git(root, ["add", "-A"]);
      git(root, ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", message]);
      return git(root, ["rev-parse", "HEAD"]).trim();
    };
    git(root, ["init", "-q", "-b", "main"]);
    mkdirSync(path.join(root, "tests"), { recursive: true });
    writeFileSync(path.join(root, "tests", "a.test.mjs"), "test(\"a\", () => {});\n");
    writeFileSync(path.join(root, "tests", "b.test.mjs"), "test(\"b\", () => {});\n");
    writeFileSync(path.join(root, "vitest.config.ts"), "export default { test: { coverage: { thresholds: { lines: 90 } } } };\n");
    writeFileSync(path.join(root, "README.md"), "x\n");
    const base = commit("base");
    writeFileSync(path.join(root, "README.md"), "y\n");
    expect(testWeakeningGates(root, base, commit("docs only"))).toEqual([]);
    rmSync(path.join(root, "tests", "a.test.mjs"));
    writeFileSync(path.join(root, "tests", "b.test.mjs"), "test.only(\"b\", () => {});\n");
    writeFileSync(path.join(root, "vitest.config.ts"), "export default { test: { coverage: { thresholds: { lines: 10 } } } };\n");
    const reasons = testWeakeningGates(root, base, commit("weaken"));
    expect(reasons.join(" | ")).toMatch(/deletes test files \(tests\/a\.test\.mjs\)/);
    expect(reasons.join(" | ")).toMatch(/skipped or focused test \(tests\/b\.test\.mjs\)/);
    expect(reasons.join(" | ")).toMatch(/check threshold .*vitest\.config\.ts/);
  });

  it.each([
    ["it.skipIf(true)(\"b\", () => {});"],
    ["describe.skipIf(process.env.CI)(\"b\", () => {});"],
    ["it.runIf(false)(\"b\", () => {});"],
    ["test.concurrent.skip(\"b\", () => {});"],
    ["describe.sequential.skip(\"b\", () => {});"],
    ["test.fails(\"b\", () => {});"],
    ["bench.only(\"b\", () => {});"],
    ["test(\"b\", (ctx) => { ctx.skip(); });"],
    ["test(\"b\", function () { this.skip(); });"],
    ["test(\"b\", (ctx) => { ctx.skip(true); });"],
    ["describe.each([1, 2])(\"b %s\", () => {}).skip;"],
    ["describe.each([1, 2]).skip(\"b %s\", () => {});"]
  ])("gates a skipped, conditional, focused or expected-failure test written as %s", (line) => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-repair-skip-"));
    roots.push(root);
    const commit = (message: string) => {
      git(root, ["add", "-A"]);
      git(root, ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", message]);
      return git(root, ["rev-parse", "HEAD"]).trim();
    };
    git(root, ["init", "-q", "-b", "main"]);
    mkdirSync(path.join(root, "tests"), { recursive: true });
    writeFileSync(path.join(root, "tests", "b.test.ts"), "test(\"b\", () => {});\n");
    const base = commit("base");
    writeFileSync(path.join(root, "tests", "b.test.ts"), `${line}\n`);
    expect(testWeakeningGates(root, base, commit("weaken")).join(" | ")).toMatch(/skipped or focused test \(tests\/b\.test\.ts\)/);
  });

  it("gates a net decrease of test cases in a surviving test file, and the whole src/sessions/ tree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-repair-cases-"));
    roots.push(root);
    const commit = (message: string) => {
      git(root, ["add", "-A"]);
      git(root, ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", message]);
      return git(root, ["rev-parse", "HEAD"]).trim();
    };
    git(root, ["init", "-q", "-b", "main"]);
    mkdirSync(path.join(root, "tests"), { recursive: true });
    mkdirSync(path.join(root, "src", "sessions"), { recursive: true });
    writeFileSync(path.join(root, "tests", "c.test.ts"), "it(\"one\", () => {});\ntest(\"two\", () => {});\n");
    writeFileSync(path.join(root, "src", "sessions", "worktreePreparation.ts"), "export {};\n");
    const base = commit("base");
    writeFileSync(path.join(root, "tests", "c.test.ts"), "it(\"one\", () => {});\n");
    expect(testWeakeningGates(root, base, commit("drop a case")).join(" | ")).toMatch(/removes test cases \(tests\/c\.test\.ts: 2 -> 1\)/);
    // A regex `.test(` call is not a test case: dropping a case while adding one still counts as fewer.
    writeFileSync(path.join(root, "tests", "c.test.ts"), "it(\"one\", () => { expect(/x/.test(\"x\")).toBe(true); });\n");
    expect(testWeakeningGates(root, base, commit("swap a case for a regex call")).join(" | ")).toMatch(/removes test cases \(tests\/c\.test\.ts: 2 -> 1\)/);
    writeFileSync(path.join(root, "src", "sessions", "worktreePreparation.ts"), "export const x = 1;\n");
    expect(candidateChangeGate(root, base, commit("touch sessions"))).toMatch(/src\/sessions\/worktreePreparation\.ts/);
  });
});
