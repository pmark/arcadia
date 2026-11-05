import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { blockerRemedyFor } from "../src/production/blockerRemedies.js";
import { listOpenRedAlerts, REVIEW_REPAIR_STOP_ALERTS } from "../src/production/redAlerts.js";
import { citedPaths, judgeSameFindingGateDefect, REVIEW_REPAIR_ESCALATIONS, REVIEW_REPAIR_GATE_DEFECT, SAME_FINDING_TITLE_SIMILARITY, titleSimilarity, type SameFindingEvidence } from "../src/production/reviewRepair.js";
import { resetProductionRepairBudget } from "../src/production/tick.js";
import type { AgentSession } from "../src/sessions/index.js";
import { runQaPrReviewCommand } from "../src/qa/prReview.js";
import { listReviewRepairs, type ReviewRepairCheck, type ReviewRepairFinding } from "../src/sessions/reviewRepair.js";
import { requirementForSession } from "../src/sessions/roleLineage.js";
import { git, hostReviewer, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * The same-finding circuit breaker (src/production/reviewRepair.ts). On
 * 2026-11-04 a reviewer failed PRs #2058, #2059 and #2061 on the same
 * host-written settlement records, in different words and with different ids
 * each time, and all three repair rounds were spent reproducing it.
 */
interface PinnedRound {
  pullRequest: number;
  head: string;
  start: string;
  settlementPaths: string[];
  sessionPaths: string[];
  findings: ReviewRepairFinding[];
  checks: ReviewRepairCheck[];
}
const { rounds } = JSON.parse(readFileSync(path.join(__dirname, "fixtures/review-repair-gate-defect/verdicts-2026-11-04.json"), "utf8")) as { rounds: [PinnedRound, PinnedRound, PinnedRound] };
const [pr2058, pr2059, pr2061] = rounds;

const evidenceFor = (previous: PinnedRound, current: PinnedRound, change: Partial<SameFindingEvidence> = {}): SameFindingEvidence => ({
  previousFindings: previous.findings,
  previousChecks: previous.checks,
  findings: current.findings,
  checks: current.checks,
  settlementPaths: current.settlementPaths,
  sessionPaths: current.sessionPaths,
  ...change
});

describe("the real verdicts of 2026-11-04", () => {
  it("pins the text as it really was: reworded each round, so no exact comparison could match", () => {
    expect(rounds.map((round) => round.pullRequest)).toEqual([2058, 2059, 2061]);
    expect(new Set(rounds.map((round) => round.findings[0].title)).size).toBe(3);
    expect(rounds.map((round) => round.findings.length)).toEqual([2, 2, 1]);
    for (const round of rounds) expect(round.checks.map((check) => check.name)).toEqual(["Correctness"]);
  });

  it("reads each title pair above the similarity bound", () => {
    for (const [left, right] of [[pr2058, pr2059], [pr2059, pr2061], [pr2058, pr2061]]) {
      expect(titleSimilarity(left.findings[0].title, right.findings[0].title)).toBeGreaterThanOrEqual(SAME_FINDING_TITLE_SIMILARITY);
    }
  });

  it("finds only the records in the findings that stop the loop, and the test file in the one that does not", () => {
    expect(citedPaths(pr2059.findings[0]).sort()).toEqual(["MISSION_LOG.md", "docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md"]);
    expect(citedPaths(pr2059.findings[1])).toEqual([".arcadia/asks/archive/agent-ask-complete-pin-work-monitor-malformed-record-7c8d8bf7c714.yaml"]);
    expect(citedPaths(pr2061.findings[0]).sort()).toEqual(["MISSION_LOG.md", "docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md"]);
    expect(citedPaths(pr2058.findings[1])).toEqual(["tests/work-monitor-failures.test.ts"]);
  });

  it("fires on round 2 (PR 2059 after 2058), though its second finding is new", () => {
    const reason = judgeSameFindingGateDefect(evidenceFor(pr2058, pr2059));
    expect(reason).toMatch(/^Gate defect: /);
    expect(reason).toContain("Plan next_action cites an Agent Ask");
    expect(reason).toContain("MISSION_LOG.md");
  });

  it("fires on round 3 (PR 2061 after 2059)", () => {
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061))).toMatch(/^Gate defect: .*Settlement records cite an Agent Ask id/);
  });

  it("never fires on the first sighting: a first failure has no previous round to repeat", () => {
    expect(judgeSameFindingGateDefect({ ...evidenceFor(pr2058, pr2058), previousFindings: [], previousChecks: [] })).toBeNull();
  });
});

describe("what keeps the repair loop running", () => {
  const code = (title: string, file: string): ReviewRepairFinding => ({
    severity: "high", title, evidence: `${file} drops the second record when the listing is truncated.`, recommendation: `Handle the truncated record in ${file}.`
  });
  const CODE_CHECK: ReviewRepairCheck = { name: "Correctness", status: "fail", evidence: "src/git/monitor.ts drops the second record." };
  const repeatedCode = (change: Partial<SameFindingEvidence>): SameFindingEvidence => ({
    previousFindings: [code("The monitor drops a truncated record", "src/git/monitor.ts")],
    previousChecks: [CODE_CHECK],
    findings: [code("The monitor drops a truncated record", "src/git/monitor.ts")],
    checks: [CODE_CHECK],
    settlementPaths: pr2059.settlementPaths,
    sessionPaths: [],
    ...change
  });

  it("does not fire on a word-for-word repeated code finding when the repair changed nothing at all", () => {
    expect(judgeSameFindingGateDefect(repeatedCode({ sessionPaths: [] }))).toBeNull();
  });

  it("does not fire on it when the repair changed only something the finding does not cite", () => {
    expect(judgeSameFindingGateDefect(repeatedCode({ sessionPaths: ["src/other.ts"] }))).toBeNull();
  });

  it("does not fire on it when the repair changed the cited file and still failed to fix it", () => {
    expect(judgeSameFindingGateDefect(repeatedCode({ sessionPaths: ["src/git/monitor.ts"] }))).toBeNull();
  });

  it("does not fire when a code finding stands beside the repeated settlement finding", () => {
    const findings = [...pr2061.findings, code("The monitor drops a truncated record", "src/git/monitor.ts")];
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { findings }))).toBeNull();
  });

  it("does not fire when one finding cites both a record and a code file", () => {
    const [first] = pr2061.findings;
    const findings = [{ ...first, evidence: `${first.evidence} The same id is parsed in src/git/monitor.ts.` }];
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { findings }))).toBeNull();
  });

  it("does not fire on a finding that names no path at all, which could be about anything", () => {
    const finding = { severity: "high", title: "Settlement records cite an Agent Ask id", evidence: "The id is wrong.", recommendation: "Fix the id." };
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { previousFindings: [finding], findings: [finding], checks: [] }))).toBeNull();
  });

  it("does not fire when a Session itself changed a cited record, because then a repair can change it too", () => {
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { sessionPaths: [...pr2061.sessionPaths, "MISSION_LOG.md"] }))).toBeNull();
  });

  it("does not fire when the settlement commit did not write the cited record", () => {
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { settlementPaths: pr2061.settlementPaths.filter((file) => file !== "MISSION_LOG.md") }))).toBeNull();
  });

  it("does not fire on a path the settlement commit wrote that is no governed record", () => {
    const finding = { ...pr2061.findings[0], evidence: "src/stray.ts was written by the settlement." };
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { previousFindings: [finding], findings: [finding], settlementPaths: ["src/stray.ts"], checks: [] }))).toBeNull();
  });

  it("does not fire when the finding was reworded past the bound", () => {
    const findings = [{ ...pr2061.findings[0], title: "The audit trail is broken" }];
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { findings }))).toBeNull();
  });

  it("does not fire when the two findings share no record", () => {
    const findings = [{ ...pr2061.findings[0], evidence: "PROJECT.md has the wrong current_action.", recommendation: "Fix it." }];
    const checks = [{ ...pr2061.checks[0], evidence: "PROJECT.md is wrong." }];
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { findings, checks }))).toBeNull();
  });

  it("does not fire when a criterion newly failed", () => {
    const checks = [...pr2061.checks, { name: "Tests", status: "fail", evidence: "MISSION_LOG.md aside, no test covers the fallback." }];
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { checks }))).toBeNull();
  });

  it("does not fire when a failed criterion's evidence names no cited record, since no finding explains it", () => {
    const checks = [{ ...pr2061.checks[0], evidence: "The scan returns the wrong order." }];
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { checks }))).toBeNull();
  });

  it("does not fire on stray path-like prose, an accepted false negative", () => {
    const [first] = pr2061.findings;
    const findings = [{ ...first, recommendation: `${first.recommendation} Fix and/or re-settle.` }];
    expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2061, { findings }))).toBeNull();
  });

  it("matches an archived Ask across rounds though its file name carries a different id each time", () => {
    const finding = (id: string) => ({
      severity: "low", title: "Settlement rewrote candidate_revision in the archived Ask", evidence: `.arcadia/asks/archive/agent-ask-complete-x-${id}.yaml changed.`, recommendation: "Keep the bytes."
    });
    const settlementPaths = [".arcadia/asks/archive/agent-ask-complete-x-7c8d8bf7c714.yaml"];
    expect(judgeSameFindingGateDefect({
      previousFindings: [finding("4468082627ea")], previousChecks: [], findings: [finding("7c8d8bf7c714")], checks: [], settlementPaths, sessionPaths: []
    })).toMatch(/^Gate defect: /);
  });

  describe("records whose text a Session's fresh Ask can change", () => {
    const ARCHIVED = ".arcadia/asks/archive/agent-ask-complete-x-7c8d8bf7c714.yaml";
    const repeated = (title: string, evidence: string): SameFindingEvidence => {
      const finding = { severity: "medium", title, evidence, recommendation: "Correct it." };
      return { previousFindings: [finding], previousChecks: [], findings: [finding], checks: [], settlementPaths: [ARCHIVED, "MISSION_LOG.md"], sessionPaths: [] };
    };

    it("does not fire on a repeated finding about the archived Ask's content, which the next round's Ask can correct", () => {
      expect(judgeSameFindingGateDefect(repeated("Archived Ask evidence claims a criterion the patch does not meet", `${ARCHIVED} says it is met.`))).toBeNull();
    });

    it("does not fire on an archived Ask finding that does not name the field the host writes, however it is worded", () => {
      expect(judgeSameFindingGateDefect(repeated("The archived Ask is stale", `${ARCHIVED} is stale.`))).toBeNull();
    });

    it("does not fire when candidate_revision is only the setting for a finding about the Ask's evidence", () => {
      expect(judgeSameFindingGateDefect(repeated("Ask evidence is stale for its candidate_revision", `${ARCHIVED} was written earlier.`))).toBeNull();
    });

    it("does not fire on the Mission Log's Result line, which quotes the Ask's evidence criteria", () => {
      expect(judgeSameFindingGateDefect(repeated("Mission Log Result records a criterion the patch does not meet", "MISSION_LOG.md says it is met; next_action is fine."))).toBeNull();
    });

    it("does not fire on a plural Session-authored subject", () => {
      expect(judgeSameFindingGateDefect(repeated("Mission Log results overstate the patch", "MISSION_LOG.md says so; next_action is fine."))).toBeNull();
    });

    it("does not fire on a Mission Log finding that names no field the host writes", () => {
      expect(judgeSameFindingGateDefect(repeated("The Mission Log entry is misleading", "MISSION_LOG.md overstates this."))).toBeNull();
    });

    it("accepts a false negative: PR 2058's next_action finding also cites the archived Ask, so that shape would not fire", () => {
      expect(judgeSameFindingGateDefect(evidenceFor(pr2059, pr2058, { findings: [pr2058.findings[0]], checks: [] }))).toBeNull();
    });
  });
});

/** The real worker tick, real Git history and settlement commits; only the reviewer's words are fixed. */
describe("the breaker in the worker tick", () => {
  const rehearsals: Rehearsal[] = [];
  afterEach(() => { for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose(); });

  const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];

  /**
   * The pinned finding, with the real Plan and archived Ask swapped for the ones
   * this fixture's settlement commit wrote: the rule matches records exactly, so
   * the words must name what this head's settlement really changed.
   */
  function pinnedWords(rehearsal: Rehearsal, pinned: PinnedRound, head: string) {
    const settled = git(rehearsal.repo, ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", `${head}^`, head]).split("\n").map((line) => line.trim());
    const plan = settled.find((file) => file.startsWith("docs/plans/"))!;
    const archived = settled.find((file) => file.startsWith(".arcadia/asks/archive/"))!;
    const localize = (text: string) => text
      .replaceAll("docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md", plan)
      .replace(/\.arcadia\/asks\/archive\/agent-ask-complete-pin-work-monitor-malformed-record-[0-9a-f]+\.yaml/g, archived);
    return {
      findings: pinned.findings.map((finding) => ({ ...finding, evidence: localize(finding.evidence), recommendation: localize(finding.recommendation) })),
      checkEvidence: localize(pinned.checks[0].evidence)
    };
  }

  /** Action A finished and its code review failed in the given words; the repair Session is running. */
  function firstRound(words: (rehearsal: Rehearsal, head: string) => ReturnType<typeof pinnedWords>): { rehearsal: Rehearsal; a: AgentSession; repair: AgentSession } {
    const rehearsal = new Rehearsal({ independentReviewers: "tick" });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate();
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const a = rehearsal.lease()!;
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    rehearsal.github.verdict = (role) => (role === "code-review" ? "fail" : "pass");
    rehearsal.github.failCriteria = ["correctness"];
    rehearsal.github.failWords = (pr) => words(rehearsal, git(rehearsal.repo, ["rev-parse", `refs/heads/${pr!.branch}`]).trim());
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    rehearsal.tick();
    rehearsal.tick();
    const repair = rehearsal.lease()!;
    expect(repair.id).not.toBe(a.id);
    return { rehearsal, a, repair };
  }

  /** The repair Session finishes, optionally changing files first, and its head is reviewed. */
  function finishRepair(rehearsal: Rehearsal, repair: AgentSession, edits: Record<string, string> = {}): void {
    for (const [file, content] of Object.entries(edits)) rehearsal.agentEdit(repair, file, content);
    rehearsal.agentFinish(repair, CRITERIA_A);
    rehearsal.tmux.exit(repair.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    rehearsal.tick();
    rehearsal.tick();
  }

  const repairs = (rehearsal: Rehearsal) => withReadOnlyDatabase(rehearsal.workspace, (db) => listReviewRepairs(db, rehearsal.actionA));
  const escalation = (rehearsal: Rehearsal) => rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA);
  const defectLogLines = (rehearsal: Rehearsal) => rehearsal.log.filter((line) => line.includes(`(${REVIEW_REPAIR_GATE_DEFECT})`));

  function stoppedOnRound2(): { rehearsal: Rehearsal; repair: AgentSession } {
    let verdicts = 0;
    const { rehearsal, repair } = firstRound((r, head) => pinnedWords(r, verdicts++ === 0 ? pr2058 : pr2059, head));
    finishRepair(rehearsal, repair);
    return { rehearsal, repair };
  }

  it("stops once on the pinned round-2 verdict: one distinct escalation, no second repair Session and no round spent", () => {
    const { rehearsal, repair } = stoppedOnRound2();
    expect(rehearsal.tmux.launches).toHaveLength(2); // the candidate and its one repair
    expect(rehearsal.lease()).toBeNull();
    expect(repairs(rehearsal).map((row) => [row.round, row.outcome, row.repair_session_id])).toEqual([[1, "launched", repair.id], [2, "gated", null]]);
    expect(repairs(rehearsal)[1].reason).toMatch(/^Gate defect: /);
    const stop = escalation(rehearsal)!;
    expect(stop.kind).toBe(REVIEW_REPAIR_GATE_DEFECT);
    expect(stop.message).toContain("Plan next_action cites an Agent Ask");
    expect(stop.remedy).toContain("fix the reviewer rule or gate");
    expect(stop.remedy).toContain("--rerun");
    expect(stop.remedy).toContain("governed Plan amendment");
    expect(stop.remedy).toMatch(/reset-repair-budget .*it does not clear this stop/);
    // The failed PR is a draft carrying one comment that says why.
    const failedPr = rehearsal.github.prs.find((pr) => pr.branch === repair.branch)!;
    expect(failedPr.isDraft).toBe(true);
    const comments = rehearsal.github.comments.filter((comment) => comment.url === failedPr.url);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("Do not merge: escalated to the operator.");
    expect(comments[0].body).toContain("Gate defect:");
  });

  it("is idempotent across ticks: nothing launches, comments, drafts, logs or spends again", () => {
    const { rehearsal } = stoppedOnRound2();
    const comments = rehearsal.github.comments.length;
    const undone = rehearsal.github.undoReadyCalls.length;
    const reviewers = rehearsal.github.reviewerCalls.length;
    const rows = repairs(rehearsal);
    for (let i = 0; i < 5; i += 1) rehearsal.tick();
    expect(rehearsal.tmux.launches).toHaveLength(2);
    expect(rehearsal.github.comments).toHaveLength(comments);
    expect(rehearsal.github.undoReadyCalls).toHaveLength(undone);
    expect(rehearsal.github.reviewerCalls).toHaveLength(reviewers);
    expect(defectLogLines(rehearsal)).toHaveLength(1);
    expect(escalation(rehearsal)?.kind).toBe(REVIEW_REPAIR_GATE_DEFECT);
    expect(repairs(rehearsal).map((row) => [row.request_id, row.round, row.outcome, row.repair_session_id])).toEqual(rows.map((row) => [row.request_id, row.round, row.outcome, row.repair_session_id]));
  });

  it("raises one notice of its own trigger, on the stop's own todo item", () => {
    const { rehearsal } = stoppedOnRound2();
    rehearsal.tick();
    const alerts = withReadOnlyDatabase(rehearsal.workspace, (db) => listOpenRedAlerts(db)).filter((alert) => alert.actionKey === rehearsal.actionA);
    expect(alerts.map((alert) => alert.trigger)).toEqual(["repair_gate_defect"]);
    expect(alerts[0].detail).toContain(`escalation:${REVIEW_REPAIR_GATE_DEFECT}:${rehearsal.actionA}`);
  });

  it("still launches round 2 on a word-for-word repeated finding about a file a Session can change, when the repair did not touch it", () => {
    const { rehearsal, repair } = firstRound(() => ({
      findings: [{ severity: "high", title: "MARKER.md has the wrong line", evidence: "MARKER.md has the wrong line.", recommendation: "Fix MARKER.md." }],
      checkEvidence: "MARKER.md has the wrong line."
    }));
    finishRepair(rehearsal, repair, { "REPAIR.md": "an unrelated change\n" });
    expect(escalation(rehearsal)).toBeUndefined();
    expect(rehearsal.tmux.launches).toHaveLength(3);
    expect(repairs(rehearsal).map((row) => [row.round, row.outcome])).toEqual([[1, "launched"], [2, "launched"]]);
  });

  it("still launches round 2 when the repair changed the cited file and the reviewer still failed it", () => {
    const { rehearsal, repair } = firstRound(() => ({
      findings: [{ severity: "high", title: "REPAIR.md is wrong", evidence: "REPAIR.md is wrong.", recommendation: "Fix REPAIR.md." }],
      checkEvidence: "REPAIR.md is wrong."
    }));
    finishRepair(rehearsal, repair, { "REPAIR.md": "the repair's attempt\n" });
    expect(escalation(rehearsal)).toBeUndefined();
    expect(rehearsal.tmux.launches).toHaveLength(3);
    expect(repairs(rehearsal).map((row) => [row.round, row.outcome])).toEqual([[1, "launched"], [2, "launched"]]);
  });

  it("still launches round 2 when the pinned settlement finding comes with a new finding about the work", () => {
    let verdicts = 0;
    const { rehearsal, repair } = firstRound((r, head) => {
      const pinned = pinnedWords(r, verdicts++ === 0 ? pr2058 : pr2059, head);
      return verdicts === 1 ? pinned : { ...pinned, findings: [...pinned.findings, { severity: "high", title: "The marker is wrong", evidence: "MARKER.md has the wrong line.", recommendation: "Fix MARKER.md." }] };
    });
    finishRepair(rehearsal, repair);
    expect(escalation(rehearsal)).toBeUndefined();
    expect(rehearsal.tmux.launches).toHaveLength(3);
  });

  it("stops on round 3 on the pinned PR 2061 verdict when round 2 had to run, spending only the rounds that could help", () => {
    let verdicts = 0;
    const { rehearsal, repair } = firstRound((r, head) => {
      const round = verdicts++;
      if (round === 2) return pinnedWords(r, pr2061, head);
      const pinned = pinnedWords(r, round === 0 ? pr2058 : pr2059, head);
      // Round 2 carries a finding about the work, so it must run; only PR 2061's verdict is all records.
      return round === 0 ? pinned : { ...pinned, findings: [...pinned.findings, { severity: "high", title: "The marker is wrong", evidence: "MARKER.md has the wrong line.", recommendation: "Fix MARKER.md." }] };
    });
    finishRepair(rehearsal, repair);
    expect(rehearsal.tmux.launches).toHaveLength(3);
    const second = rehearsal.lease()!;
    finishRepair(rehearsal, second);
    expect(rehearsal.tmux.launches).toHaveLength(3); // the third repair round never launched
    expect(rehearsal.lease()).toBeNull();
    expect(repairs(rehearsal).map((row) => [row.round, row.outcome])).toEqual([[1, "launched"], [2, "launched"], [3, "gated"]]);
    expect(escalation(rehearsal)).toMatchObject({ kind: REVIEW_REPAIR_GATE_DEFECT, message: expect.stringContaining("Settlement records cite an Agent Ask id") });
  });

  it("still launches round 2 on a repeated finding about the archived Ask's content, so a corrected Ask gets its round", () => {
    const { rehearsal, repair } = firstRound((r, head) => {
      const archived = git(r.repo, ["-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", `${head}^`, head]).split("\n").map((line) => line.trim()).find((file) => file.startsWith(".arcadia/asks/archive/"))!;
      return {
        findings: [{ severity: "medium", title: "Archived Ask evidence claims a criterion the patch does not meet", evidence: `${archived} says the criterion is met.`, recommendation: "Correct the Ask." }],
        checkEvidence: `${archived} says the criterion is met.`
      };
    });
    finishRepair(rehearsal, repair);
    expect(escalation(rehearsal)).toBeUndefined();
    expect(rehearsal.tmux.launches).toHaveLength(3);
    expect(repairs(rehearsal).map((row) => [row.round, row.outcome])).toEqual([[1, "launched"], [2, "launched"]]);
  });

  it("does not fire against a different reviewer role's previous round", () => {
    let verdicts = 0;
    const { rehearsal, repair } = firstRound((r, head) => pinnedWords(r, verdicts++ === 0 ? pr2058 : pr2059, head));
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE production_review_repairs SET role = 'qa'").run());
    finishRepair(rehearsal, repair);
    expect(escalation(rehearsal)?.kind).not.toBe(REVIEW_REPAIR_GATE_DEFECT);
    expect(rehearsal.tmux.launches).toHaveLength(3);
  });

  it("names the gate defect rather than exhaustion when the run's rounds are also spent", () => {
    let verdicts = 0;
    const { rehearsal, repair } = firstRound((r, head) => pinnedWords(r, verdicts++ === 0 ? pr2058 : pr2059, head));
    withDatabase(rehearsal.workspace, (db) => {
      for (const round of [2, 3]) {
        db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
          start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, created_at, updated_at)
          SELECT ?, action_key, policy_epoch, ?, 's', 'b', 'h', 'r', NULL, role, 'fail', 'x', NULL, '[]', '[]', ?, 'launched', created_at, updated_at FROM production_review_repairs LIMIT 1`)
          .run(`earlier-${round}`, round, `earlier-session-${round}`);
      }
    });
    finishRepair(rehearsal, repair);
    expect(escalation(rehearsal)?.kind).toBe(REVIEW_REPAIR_GATE_DEFECT);
    expect(rehearsal.tmux.launches).toHaveLength(2);
  });

  it("leaves an authority-adjacent verdict to the authority stop, which is checked first", () => {
    let verdicts = 0;
    const { rehearsal, repair } = firstRound((r, head) => {
      const round = verdicts++;
      const pinned = pinnedWords(r, round === 0 ? pr2058 : pr2059, head);
      return round === 0 ? pinned : { ...pinned, findings: pinned.findings.map((finding, index) => index === 0 ? { ...finding, title: `${finding.title}, broadening the worker's merge authority` } : finding) };
    });
    finishRepair(rehearsal, repair);
    expect(escalation(rehearsal)).toMatchObject({ kind: "review_repair_gated", message: expect.stringContaining("authority-adjacent") });
    expect(rehearsal.tmux.launches).toHaveLength(2);
  });

  it("does not fire across production runs: a finding from an earlier epoch gets this run's round", () => {
    let verdicts = 0;
    const { rehearsal, repair } = firstRound((r, head) => pinnedWords(r, verdicts++ === 0 ? pr2058 : pr2059, head));
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE production_review_repairs SET policy_epoch = policy_epoch - 1").run());
    finishRepair(rehearsal, repair);
    expect(escalation(rehearsal)?.kind).not.toBe(REVIEW_REPAIR_GATE_DEFECT);
    expect(rehearsal.tmux.launches).toHaveLength(3);
  });

  describe("after the stop", () => {
    /** The remedy's route, through the real command: the operator marks the PR ready and reruns the code review. */
    const operatorRerun = (rehearsal: Rehearsal, repair: AgentSession) => {
      const pr = rehearsal.github.prs.find((candidate) => candidate.branch === repair.branch)!;
      pr.isDraft = false;
      return runQaPrReviewCommand(
        { workspace: rehearsal.workspace, pullRequest: pr.url, role: "code-review", rerun: true },
        { runCommand: rehearsal.github.runCommand, selectReviewer: () => hostReviewer(), now: () => rehearsal.now }
      );
    };
    const launchedRounds = (rehearsal: Rehearsal) => repairs(rehearsal).filter((row) => row.repair_session_id !== null).length;

    it("the budget reset alone leaves the stop standing, as its remedy says", () => {
      const { rehearsal } = stoppedOnRound2();
      withDatabase(rehearsal.workspace, (db) => resetProductionRepairBudget(db, rehearsal.actionA));
      expect(escalation(rehearsal)?.kind).toBe(REVIEW_REPAIR_GATE_DEFECT);
      rehearsal.tick();
      expect(escalation(rehearsal)?.kind).toBe(REVIEW_REPAIR_GATE_DEFECT);
      expect(rehearsal.tmux.launches).toHaveLength(2);
    });

    it("a rerun that fails the same way stops here again, spending nothing: only a changed judgement gets past it", () => {
      const { rehearsal, repair } = stoppedOnRound2();
      const before = repairs(rehearsal)[1].verdict_request_id;
      expect(operatorRerun(rehearsal, repair).data.verdict).toBe("fail");
      rehearsal.tick();
      rehearsal.tick();
      expect(repairs(rehearsal)[1].verdict_request_id).not.toBe(before); // the new verdict was judged afresh
      expect(repairs(rehearsal)[1]).toMatchObject({ outcome: "gated", repair_session_id: null });
      expect(escalation(rehearsal)?.kind).toBe(REVIEW_REPAIR_GATE_DEFECT);
      expect(launchedRounds(rehearsal)).toBe(1);
      expect(rehearsal.tmux.launches).toHaveLength(2);
    });

    it("a rerun that passes clears it once the tick has run QA itself, with no repair round and no budget reset", () => {
      const { rehearsal, repair } = stoppedOnRound2();
      rehearsal.github.verdict = () => "pass";
      const qaBefore = rehearsal.github.reviewerCalls.filter((call) => call.role === "qa").length;
      expect(operatorRerun(rehearsal, repair).data.verdict).toBe("pass");
      expect(escalation(rehearsal)?.kind).toBe(REVIEW_REPAIR_GATE_DEFECT); // QA is still outstanding
      rehearsal.tickUntil(() => escalation(rehearsal)?.kind !== REVIEW_REPAIR_GATE_DEFECT, 6);
      expect(rehearsal.github.reviewerCalls.filter((call) => call.role === "qa").length).toBeGreaterThan(qaBefore);
      expect(launchedRounds(rehearsal)).toBe(1);
    });

    it("a judgement revision bump re-reviews the head by itself and clears it, with no budget reset", () => {
      const { rehearsal, repair } = stoppedOnRound2();
      const reviewers = rehearsal.github.reviewerCalls.length;
      rehearsal.github.verdict = () => "pass";
      // As tests/fast-rehearsal/judgement-revision-rereview.test.ts: the verdict was judged under an earlier revision.
      withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE session_role_attempts SET criteria_fingerprint = ? WHERE role = 'code-review' AND status = 'failed'")
        .run(requirementForSession(rehearsal.repo, repair)!.criteriaFingerprint));
      rehearsal.tickUntil(() => escalation(rehearsal)?.kind !== REVIEW_REPAIR_GATE_DEFECT, 8);
      expect(rehearsal.github.reviewerCalls.length).toBeGreaterThan(reviewers);
      expect(launchedRounds(rehearsal)).toBe(1);
    });

    it("a rerun that fails on a different finding a Session can fix launches the repair and clears the stop", () => {
      const { rehearsal, repair } = stoppedOnRound2();
      rehearsal.github.failWords = () => ({
        findings: [{ severity: "high", title: "The marker is wrong", evidence: "MARKER.md has the wrong line.", recommendation: "Fix MARKER.md." }],
        checkEvidence: "MARKER.md has the wrong line."
      });
      expect(operatorRerun(rehearsal, repair).data.verdict).toBe("fail");
      rehearsal.tick();
      expect(escalation(rehearsal)?.kind).not.toBe(REVIEW_REPAIR_GATE_DEFECT);
      expect(launchedRounds(rehearsal)).toBe(2);
      expect(rehearsal.tmux.launches).toHaveLength(3);
    });
  });
});

describe("the new kind's registrations", () => {
  it("is one of the review repair escalations, so every reader of that set holds and clears it", () => {
    expect(REVIEW_REPAIR_ESCALATIONS.has(REVIEW_REPAIR_GATE_DEFECT)).toBe(true);
    expect(REVIEW_REPAIR_STOP_ALERTS[REVIEW_REPAIR_GATE_DEFECT]).toEqual({ trigger: "repair_gate_defect", outcome: "gated" });
  });

  it("gives the operator a remedy naming the fix and the reset, and grants nothing", () => {
    const remedy = blockerRemedyFor(REVIEW_REPAIR_GATE_DEFECT)!;
    expect(remedy).toMatchObject({ remedyActionId: "operator-step", oneClick: false });
    expect(remedy.consequence).toMatch(/reviewer rule or gate/);
    expect(remedy.consequence).toContain("governed Plan amendment");
    expect(remedy.consequence).toContain("arcadia production reset-repair-budget");
    expect(blockerRemedyFor("repair_gate_defect")).toMatchObject({ oneClick: false, surface: "todo" });
  });
});
