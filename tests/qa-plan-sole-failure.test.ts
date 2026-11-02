import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { createReviewItem } from "../src/db/repositories.js";
import {
  ensureQaPlanWaiver,
  getQaPlanWaiver,
  independentVerdictGateWithQaPlanWaiver,
  MAX_QA_PLAN_ISSUE_ATTEMPTS,
  qaPlanSoleFailureOnHead
} from "../src/production/independentReview.js";
import { classifyRecoverySignals } from "../src/production/recoverySignals.js";
import { attemptReviewRepair } from "../src/production/reviewRepair.js";
import { getSession, type AgentSession } from "../src/sessions/index.js";
import { independentVerdictReadiness, requirementForSession } from "../src/sessions/roleLineage.js";
import { launchedRepairRounds, listReviewRepairs } from "../src/sessions/reviewRepair.js";
import { git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Decision 0169: a QA verdict whose only failure is the host-written Operator
 * QA plan (which no repair Session can change) spends no repair round, stops
 * blocking that head, records one operator check step as unverified and
 * requests one Issue. Real tick over the shared rehearsal fixture; only the
 * GitHub CLI (including `gh issue create`, the injected runner) and the
 * reviewer model are stubbed. Shapes are classified by the recovery-signal
 * classifier (src/production/recoverySignals.ts).
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const PLAN_TITLE = "Operator QA plan uses the wrong evidence for acceptance criterion 1";

interface Options {
  /** What the stubbed QA reviewer fails; null passes every QA criterion (no QA verdict failure at all). */
  qaFails?: string[] | null;
  qaFindingTitle?: string;
  /** Skip the QA tick: stop with code review passed and QA not yet run. */
  stopBeforeQa?: boolean;
}

/** Action A preserved, readied, code review passed; with `stopBeforeQa` false the QA tick has run too. */
function reviewed(options: Options = {}, track = true): { rehearsal: Rehearsal; a: AgentSession; head: string } {
  const rehearsal = new Rehearsal({ independentReviewers: "tick" });
  if (track) rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  const a = rehearsal.lease()!;
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  rehearsal.agentFinish(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  rehearsal.github.verdict = (role) => (role === "qa" && options.qaFails !== null ? "fail" : "pass");
  rehearsal.github.failCriteria = options.qaFails ?? ["operator-qa-plan"];
  rehearsal.github.findingTitle = options.qaFindingTitle ?? PLAN_TITLE;
  expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion"); // preserved behind a draft PR
  rehearsal.tick(); // ready
  rehearsal.tick(); // code review passes
  if (!options.stopBeforeQa) rehearsal.tick(); // QA runs
  return { rehearsal, a, head: git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim() };
}

const repairs = (rehearsal: Rehearsal) => withReadOnlyDatabase(rehearsal.workspace, (db) => listReviewRepairs(db, rehearsal.actionA));
const qaAttempts = (rehearsal: Rehearsal) => rehearsal.attempts("write-marker-a").filter((attempt) => attempt.role === "qa");
const waiver = (rehearsal: Rehearsal, head: string) => withDatabase(rehearsal.workspace, (db) => getQaPlanWaiver(db, rehearsal.actionA, head));
const mainHead = (rehearsal: Rehearsal) => git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim();

describe("a QA verdict whose only failure is the operator QA plan", () => {
  it("launches no repair Session, records no repair round, does not block the head and records the unverified step", () => {
    const { rehearsal, a, head } = reviewed();
    expect(rehearsal.sessions().map((session) => session.id)).toEqual([a.id]);
    expect(repairs(rehearsal)).toEqual([]);
    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => launchedRepairRounds(db, rehearsal.actionA, 1))).toBe(0);
    expect(rehearsal.github.undoReadyCalls).toEqual([]);
    expect(rehearsal.github.comments).toEqual([]);
    expect(rehearsal.github.prs[0].isDraft).toBe(false);
    // QA's verdict stays a recorded failure (never rewritten as a pass, never rerun) ...
    expect(qaAttempts(rehearsal).map((attempt) => [attempt.status, attempt.target_head])).toEqual([["failed", head]]);
    expect(rehearsal.github.reviewerCalls.map((call) => call.role)).toEqual(["code-review", "qa"]);
    // ... and the independent verdict gate no longer treats it as blocking, so the head lands.
    expect(mainHead(rehearsal)).toBe(head);
    expect(rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA)).toBeUndefined();
    // The operator-unverified record: stored per Action and head, logged, and in the Action's journey.
    const row = waiver(rehearsal, head)!;
    expect(row.record).toContain(`Operator QA plan unverified for ${rehearsal.actionA} at ${head}`);
    expect(row.record).toContain("one operator check step went unverified and QA no longer blocks this head (Decision 0169)");
    expect(row.verdict_request_id).toBe(qaAttempts(rehearsal)[0].request_id);
    expect(rehearsal.log.some((line) => line.includes(row.record))).toBe(true);
    const journey = withReadOnlyDatabase(rehearsal.workspace, (db) =>
      db.prepare("SELECT kind, message FROM action_journey_log WHERE action_key = ? AND kind = 'qa_plan_unverified'").all(rehearsal.actionA)) as Array<{ message: string }>;
    expect(journey.map((entry) => entry.message)).toEqual([row.record]);
    // The same facts through the classifier the signals use.
    expect(classifyRecoverySignals({ reviewRepairs: [{ requestId: "r", actionKey: "a/b", round: 1, role: "qa", verdict: "fail", outcome: "x", at: "2026-11-02T00:00:00Z",
      failedChecks: [{ criterion: "operator-qa-plan", status: "fail" }] }] }).map((signal) => signal.failureClass)).toEqual(["sole_failure"]);
  });

  it("requests one Issue per Action and head through the injected runner, and a replay requests no second", () => {
    const { rehearsal, a, head } = reviewed();
    expect(rehearsal.github.issues).toHaveLength(1);
    const [issue] = rehearsal.github.issues;
    expect(issue.title).toBe(`QA verdict failed only the Operator QA plan: ${rehearsal.actionA} at ${head.slice(0, 12)}`);
    expect(issue.body).toContain(`Operator QA plan unverified for ${rehearsal.actionA} at ${head}`);
    expect(issue.body).toContain("one operator check step went unverified");
    expect(waiver(rehearsal, head)).toMatchObject({ issue_url: issue.url, issue_attempts: 1, issue_error: null });
    for (let i = 0; i < 3; i += 1) rehearsal.tick();
    expect(rehearsal.github.issues).toHaveLength(1);
    // Replaying the waiver record itself (a restart, or the gate asked again) files nothing more.
    const failure = withDatabase(rehearsal.workspace, (db) => qaPlanSoleFailureOnHead(db, { session: getSession(db, a.id)!, repoRoot: rehearsal.repo }));
    if (failure) {
      // Readiness may no longer hold once the head landed; when it does, the replay is still a no-op.
      withDatabase(rehearsal.workspace, (db) => ensureQaPlanWaiver(db, { session: getSession(db, a.id)!, failure, now: rehearsal.now, cwd: rehearsal.repo, runCommand: rehearsal.github.runCommand }));
    }
    expect(rehearsal.github.issues).toHaveLength(1);
    expect(waiver(rehearsal, head)?.issue_attempts).toBe(1);
  });

  /** `reviewed()` with `gh issue create` failing the given number of times first. */
  const reviewedWithIssueFailures = (failures: string[]) => {
    const rehearsal = new Rehearsal({ independentReviewers: "tick" });
    rehearsals.push(rehearsal);
    rehearsal.github.issueFailures = failures;
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate();
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const a = rehearsal.lease()!;
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    rehearsal.github.verdict = (role) => (role === "qa" ? "fail" : "pass");
    rehearsal.github.failCriteria = ["operator-qa-plan"];
    rehearsal.github.findingTitle = PLAN_TITLE;
    for (let i = 0; i < 4; i += 1) rehearsal.tick();
    return { rehearsal, a, head: git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim() };
  };

  it("logs a failure to file the Issue without changing the verdict outcome", () => {
    const control = reviewed();
    const failing = reviewedWithIssueFailures(Array.from({ length: MAX_QA_PLAN_ISSUE_ATTEMPTS }, () => "HTTP 502: bad gateway"));
    // The same outcome as when filing works: the head lands, no repair, no draft.
    expect(mainHead(failing.rehearsal)).toBe(failing.head);
    expect(mainHead(control.rehearsal)).toBe(control.head);
    expect(failing.rehearsal.sessions()).toHaveLength(control.rehearsal.sessions().length);
    expect(repairs(failing.rehearsal)).toEqual([]);
    expect(failing.rehearsal.github.undoReadyCalls).toEqual([]);
    expect(failing.rehearsal.github.issues).toEqual([]);
    const row = waiver(failing.rehearsal, failing.head)!;
    expect(row).toMatchObject({ issue_url: null, issue_error: "HTTP 502: bad gateway" });
    expect(row.issue_attempts).toBeGreaterThanOrEqual(1);
    expect(row.issue_attempts).toBeLessThanOrEqual(MAX_QA_PLAN_ISSUE_ATTEMPTS);
    expect(failing.rehearsal.log.some((line) => line.includes("Filing the Issue for the unverified Operator QA plan") && line.includes("the verdict outcome is unchanged: HTTP 502: bad gateway"))).toBe(true);
    // The unverified record is written whether or not the Issue could be filed.
    expect(row.record).toContain("one operator check step went unverified");
  });

  it("retries a failed filing and files exactly one Issue once it works", () => {
    const retried = reviewedWithIssueFailures(["HTTP 502: bad gateway"]);
    expect(mainHead(retried.rehearsal)).toBe(retried.head);
    expect(retried.rehearsal.github.issues).toHaveLength(1);
    expect(waiver(retried.rehearsal, retried.head)).toMatchObject({ issue_attempts: 2, issue_error: null, issue_url: retried.rehearsal.github.issues[0].url });
    for (let i = 0; i < 2; i += 1) retried.rehearsal.tick();
    expect(retried.rehearsal.github.issues).toHaveLength(1);
  });

  it("stops asking GitHub after the attempt bound", () => {
    const { rehearsal, a, head } = reviewed();
    withDatabase(rehearsal.workspace, (db) => {
      db.prepare("UPDATE production_qa_plan_waivers SET issue_url = NULL, issue_attempts = ? WHERE target_head = ?").run(MAX_QA_PLAN_ISSUE_ATTEMPTS, head);
      const session = getSession(db, a.id)!;
      const failure = qaPlanSoleFailureOnHead(db, { session, repoRoot: rehearsal.repo })!;
      ensureQaPlanWaiver(db, { session, failure, now: rehearsal.now, cwd: rehearsal.repo, runCommand: rehearsal.github.runCommand });
    });
    expect(rehearsal.github.issues).toHaveLength(1); // only the original filing
  });
});

describe("a QA verdict that still blocks and follows the existing repair path", () => {
  const expectRepairPath = (rehearsal: Rehearsal, head: string) => {
    expect(rehearsal.sessions()).toHaveLength(2); // the repair Session took over
    expect(repairs(rehearsal).map((row) => [row.role, row.outcome])).toEqual([["qa", "launched"]]);
    expect(rehearsal.github.prs[0].isDraft).toBe(true);
    expect(mainHead(rehearsal)).not.toBe(head);
    expect(waiver(rehearsal, head)).toBeNull();
    expect(rehearsal.github.issues).toEqual([]);
  };

  it("when another check also fails (the mixed shape)", () => {
    const { rehearsal, head } = reviewed({ qaFails: ["operator-qa-plan", "tests-and-evidence"] });
    expectRepairPath(rehearsal, head);
  });

  it("when a different check is the only failure", () => {
    const { rehearsal, head } = reviewed({ qaFails: ["tests-and-evidence"] });
    expectRepairPath(rehearsal, head);
  });

  it("when the only failed check is the plan but a finding concerns anything else", () => {
    const { rehearsal, head } = reviewed({ qaFindingTitle: "Defect" });
    expectRepairPath(rehearsal, head);
  });

  it("when the plan check fails and a finding concerns authority", () => {
    const { rehearsal, head } = reviewed({ qaFindingTitle: "Operator QA plan grants a credential" });
    // An authority-adjacent verdict is a gated stop, never a repair and never a waiver.
    expect(repairs(rehearsal).map((row) => [row.outcome])).toEqual([["gated"]]);
    expect(rehearsal.sessions()).toHaveLength(1);
    expect(mainHead(rehearsal)).not.toBe(head);
    expect(waiver(rehearsal, head)).toBeNull();
    expect(rehearsal.github.issues).toEqual([]);
  });

  it("when the plan was refused as unavailable", () => {
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
    rehearsal.github.verdict = (role) => (role === "qa" ? "fail" : "pass");
    rehearsal.github.failCriteria = ["operator-qa-plan"];
    rehearsal.github.findingTitle = PLAN_TITLE;
    rehearsal.tick();
    withDatabase(rehearsal.workspace, (db) => {
      const row = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${a.id}`) as { receipt_json: string };
      const receipt = { ...JSON.parse(row.receipt_json), qaPlanRefusal: "Action declares no acceptance criteria." };
      db.prepare("UPDATE candidate_preservation_receipts SET receipt_json = ? WHERE request_id = ?").run(JSON.stringify(receipt), `worker-tick-preserve-${a.id}`);
    });
    for (let i = 0; i < 3; i += 1) rehearsal.tick();
    const head = git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim();
    expectRepairPath(rehearsal, head);
  });
});

/**
 * Verdict shapes the stubbed reviewer cannot produce (a not-checked plan, a
 * code-review role, a mislabelled report): seeded as the persisted QA report
 * and lineage attempt `arcadia qa pr` would have recorded, on a candidate whose
 * code review passed and whose QA has not run.
 */
describe("seeded QA verdict shapes", () => {
  interface Seed {
    role?: string;
    verdict?: string;
    checks?: Array<{ criterion?: string; name: string; status: string; evidence: string }>;
    findings?: Array<{ severity: string; title: string; evidence: string; recommendation: string }>;
    context?: Record<string, unknown>;
    attemptRole?: "qa" | "code-review";
    receipt?: Record<string, unknown>;
    attemptStatus?: "failed" | "passed";
  }
  const PLAN_FAIL = { criterion: "operator-qa-plan", name: "Operator QA plan", status: "fail", evidence: "Step 4 inspects the wrong file." };
  const OTHERS = ["correctness", "scope-fidelity", "approval-boundaries", "managed-documents", "hidden-consequences", "tests-and-evidence"].map((criterion) => ({
    criterion, name: criterion, status: "pass", evidence: "ok"
  }));
  const PLAN_FINDING = { severity: "medium", title: PLAN_TITLE, evidence: "Step 4 inspects the wrong file.", recommendation: "Inspect the test file." };

  /** One candidate (code review passed, QA not yet run) shared by the shape cases; each case seeds, asks the gate, and unseeds. */
  let shared: { rehearsal: Rehearsal; a: AgentSession; head: string };
  beforeAll(() => { shared = reviewed({ stopBeforeQa: true }, false); }, 180_000);
  afterAll(() => { shared?.rehearsal.dispose(); });

  function seed(input: Seed): void {
    const { rehearsal, a, head } = shared;
    withDatabase(rehearsal.workspace, (db) => {
      const session = getSession(db, a.id)!;
      const readiness = independentVerdictReadiness(db, { session, repoRoot: rehearsal.repo });
      if (!readiness.ready) throw new Error(readiness.reasons.join(" "));
      const item = createReviewItem(db, {
        decisionNeeded: "seeded QA verdict", recommendation: "seeded", sourceInput: "https://github.com/pmark/rehearsal/pull/7", proposedAction: "none",
        resolvedIntent: "IndependentPullRequestReview", confidenceLabel: "high", confidence: 1, missingFields: [],
        context: {
          schemaVersion: 2, candidate: { headSha: head, url: "https://github.com/pmark/rehearsal/pull/7" }, verdict: input.verdict ?? "fail",
          summary: "seeded summary", findings: input.findings ?? [PLAN_FINDING], checks: input.checks ?? [PLAN_FAIL, ...OTHERS], residualRisks: [],
          role: input.role ?? "qa", reportPath: "artifacts/qa/seeded.md", ...input.context
        }
      });
      const requirement = requirementForSession(rehearsal.repo, session)!;
      const role = input.attemptRole ?? "qa";
      db.prepare(`INSERT INTO session_role_attempts (id, requirement_id, input_revision, role, ordinal, request_id, actor_id, mutation_owner, status,
        target_head, criteria_fingerprint, evidence_fingerprint, terminal_receipt_json, created_at, updated_at)
        VALUES ('seeded-attempt', ?, ?, ?, ?, 'seeded-attempt', 'seeded-independent-reviewer', 0, ?, ?, ?, ?, ?, ?, ?)`)
        .run(requirement.requirementId, requirement.inputRevision, role, role === "qa" ? 1 : 2, input.attemptStatus ?? "failed",
          head, readiness.binding.criteriaFingerprint, readiness.binding.evidenceFingerprint,
          JSON.stringify({ verdict: "fail", decisionId: item.id, ...input.receipt }), a.created_at, a.created_at);
    });
  }
  function unseed(): void {
    withDatabase(shared.rehearsal.workspace, (db) => {
      db.prepare("DELETE FROM session_role_attempts WHERE id = 'seeded-attempt'").run();
      db.prepare("DELETE FROM production_qa_plan_waivers").run();
    });
    shared.rehearsal.github.issues.length = 0;
  }
  const ask = (runCommand = shared.rehearsal.github.runCommand) => withDatabase(shared.rehearsal.workspace, (db) =>
    independentVerdictGateWithQaPlanWaiver(db, { session: getSession(db, shared.a.id)!, repoRoot: shared.rehearsal.repo, now: shared.rehearsal.now, runCommand }));
  const waived = () => withDatabase(shared.rehearsal.workspace, (db) => qaPlanSoleFailureOnHead(db, { session: getSession(db, shared.a.id)!, repoRoot: shared.rehearsal.repo }));
  afterEach(unseed);

  it("the plain sole-failure shape is waived by the gate, with the record and one Issue", () => {
    seed({});
    expect(waived()).toMatchObject({ head: shared.head });
    expect(ask()).toMatchObject({ satisfied: true });
    expect(waiver(shared.rehearsal, shared.head)?.record).toContain("one operator check step went unverified");
    expect(shared.rehearsal.github.issues).toHaveLength(1);
  });

  it("a QA failure that is not the latest attempt on this binding is not waived", () => {
    seed({ attemptStatus: "passed" });
    expect(waived()).toBeNull();
  });

  const blocking: Array<[string, Seed]> = [
    ["operator-qa-plan itself is not-checked (the sibling checks all pass)", { checks: [{ ...PLAN_FAIL, status: "not-checked" }, ...OTHERS] }],
    ["operator-qa-plan itself is not-checked, with a plan finding", { checks: [{ ...PLAN_FAIL, status: "not-checked" }, ...OTHERS], findings: [PLAN_FINDING] }],
    ["operator-qa-plan passes and nothing fails", { checks: [{ ...PLAN_FAIL, status: "pass" }, ...OTHERS], findings: [] }],
    ["another check is not-checked", { checks: [PLAN_FAIL, ...OTHERS.slice(1), { ...OTHERS[0], status: "not-checked" }] }],
    ["another check is inherited", { checks: [PLAN_FAIL, ...OTHERS.slice(1), { ...OTHERS[0], status: "inherited" }] }],
    ["another check is not-applicable", { checks: [PLAN_FAIL, ...OTHERS.slice(1), { ...OTHERS[0], status: "not-applicable" }] }],
    ["another check fails (mixed)", { checks: [PLAN_FAIL, ...OTHERS.slice(1), { ...OTHERS[0], status: "fail" }] }],
    ["a deterministic check with no criterion id is not-checked", { checks: [PLAN_FAIL, ...OTHERS, { name: "GitHub validation", status: "not-checked", evidence: "none" }] }],
    ["a finding concerns anything else", { findings: [PLAN_FINDING, { severity: "high", title: "Rollback drops the table", evidence: "x", recommendation: "y" }] }],
    ["the only finding concerns anything else", { findings: [{ severity: "high", title: "Rollback drops the table", evidence: "x", recommendation: "y" }] }],
    ["a finding's title only mentions the plan", { findings: [{ severity: "high", title: "Missing test; the Operator QA plan is fine", evidence: "x", recommendation: "y" }] }],
    ["a plan finding concerns authority", { findings: [{ ...PLAN_FINDING, recommendation: "Grant the credential." }] }],
    ["the plan check's evidence concerns authority", { checks: [{ ...PLAN_FAIL, evidence: "Needs operator authorization." }, ...OTHERS] }],
    ["the verdict is needs-follow-up, not fail", { verdict: "needs-follow-up" }],
    ["the report is a code-review report", { role: "code-review" }],
    ["the report's candidate is another head", { context: { candidate: { headSha: "0".repeat(40), url: "https://github.com/pmark/rehearsal/pull/7" } } }],
    ["the report carries reviewer unavailability", { context: { reviewerUnavailable: "reviewer crashed" } }],
    ["the report carries a variance reason", { context: { varianceReason: "variance" } }],
    ["the attempt receipt is stale", { receipt: { stale: true } }],
    ["the attempt receipt is reviewer unavailability", { receipt: { reviewerUnavailable: "reviewer crashed" } }],
    ["the attempt receipt names no report", { receipt: { decisionId: "missing-decision" } }],
    ["the report lists no checks", { checks: [] }]
  ];
  it.each(blocking)("keeps the gate blocking when %s", (_name, input) => {
    seed(input);
    expect(waived()).toBeNull();
    expect(ask()).toMatchObject({ satisfied: false, code: "awaiting_independent_verdicts" });
    expect(waiver(shared.rehearsal, shared.head)).toBeNull();
    expect(shared.rehearsal.github.issues).toEqual([]);
  });

  it("a failed code-review verdict (the code review role) is never waived, whatever its checks say", () => {
    seed({ attemptRole: "code-review", role: "code-review" });
    expect(waived()).toBeNull();
    expect(ask()).toMatchObject({ satisfied: false });
    expect(waiver(shared.rehearsal, shared.head)).toBeNull();
  });

  it("a runner that throws while filing the Issue is logged and leaves the gate satisfied", () => {
    seed({});
    const logged: string[] = [];
    const gate = withDatabase(shared.rehearsal.workspace, (db) => independentVerdictGateWithQaPlanWaiver(db, {
      session: getSession(db, shared.a.id)!, repoRoot: shared.rehearsal.repo, now: shared.rehearsal.now, log: (line) => logged.push(line),
      runCommand: () => { throw new Error("gh vanished"); }
    }));
    expect(gate).toMatchObject({ satisfied: true });
    expect(waiver(shared.rehearsal, shared.head)).toMatchObject({ issue_url: null, issue_error: "gh vanished", issue_attempts: 1 });
    expect(logged.some((line) => line.includes("the verdict outcome is unchanged: gh vanished"))).toBe(true);
  });

  it("stays blocked when the unverified step cannot be recorded", () => {
    seed({});
    withDatabase(shared.rehearsal.workspace, (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS production_qa_plan_waivers (action_key TEXT NOT NULL, target_head TEXT NOT NULL, session_id TEXT NOT NULL,
        verdict_request_id TEXT NOT NULL, pull_request_url TEXT, record TEXT NOT NULL, issue_url TEXT, issue_attempts INTEGER NOT NULL DEFAULT 0,
        issue_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (action_key, target_head));
        CREATE TRIGGER qa_plan_waiver_unwritable BEFORE INSERT ON production_qa_plan_waivers BEGIN SELECT RAISE(ABORT, 'unwritable'); END;`);
    });
    try {
      expect(ask()).toMatchObject({ satisfied: false, code: "awaiting_independent_verdicts" });
      expect(waiver(shared.rehearsal, shared.head)).toBeNull();
      expect(shared.rehearsal.github.issues).toEqual([]);
    } finally {
      withDatabase(shared.rehearsal.workspace, (db) => db.exec("DROP TRIGGER IF EXISTS qa_plan_waiver_unwritable"));
    }
  });

  it("attemptReviewRepair declines a sole plan failure before any row, draft or comment", () => {
    seed({});
    const step = withDatabase(shared.rehearsal.workspace, (db) => attemptReviewRepair({
      db, repoRoot: shared.rehearsal.repo, session: getSession(db, shared.a.id)!, now: shared.rehearsal.now,
      runCommand: shared.rehearsal.github.runCommand, escalate: () => {}, launch: () => { throw new Error("must not launch"); }
    }));
    expect(step.kind).toBe("not_applicable");
    expect(repairs(shared.rehearsal)).toEqual([]);
    expect(shared.rehearsal.github.undoReadyCalls).toEqual([]);
    expect(shared.rehearsal.github.comments).toEqual([]);
  });
});

describe("seeded shapes on a live tick", () => {
  // The worst mutant of the classifier (dropping its status check) lets a not-checked plan read as a sole failure.
  it("a not-checked operator-qa-plan stays blocked through the tick and takes the repair path", () => {
    const { rehearsal, a, head } = reviewed({ stopBeforeQa: true });
    withDatabase(rehearsal.workspace, (db) => {
      const session = getSession(db, a.id)!;
      const readiness = independentVerdictReadiness(db, { session, repoRoot: rehearsal.repo });
      if (!readiness.ready) throw new Error(readiness.reasons.join(" "));
      const checks = [{ criterion: "operator-qa-plan", name: "Operator QA plan", status: "not-checked", evidence: "The plan was not shown." }];
      const item = createReviewItem(db, {
        decisionNeeded: "seeded", recommendation: "seeded", sourceInput: "https://github.com/pmark/rehearsal/pull/7", proposedAction: "none",
        resolvedIntent: "IndependentPullRequestReview", confidenceLabel: "high", confidence: 1, missingFields: [],
        context: { schemaVersion: 2, candidate: { headSha: head, url: "https://github.com/pmark/rehearsal/pull/7" }, verdict: "fail", summary: "s",
          findings: [{ severity: "medium", title: PLAN_TITLE, evidence: "e", recommendation: "r" }], checks, residualRisks: [], role: "qa", reportPath: "artifacts/qa/seeded.md" }
      });
      const requirement = requirementForSession(rehearsal.repo, session)!;
      db.prepare(`INSERT INTO session_role_attempts (id, requirement_id, input_revision, role, ordinal, request_id, actor_id, mutation_owner, status,
        target_head, criteria_fingerprint, evidence_fingerprint, terminal_receipt_json, created_at, updated_at)
        VALUES ('seeded-attempt', ?, ?, 'qa', 1, 'seeded-attempt', 'seeded-independent-reviewer', 0, 'failed', ?, ?, ?, ?, ?, ?)`)
        .run(requirement.requirementId, requirement.inputRevision, head, readiness.binding.criteriaFingerprint, readiness.binding.evidenceFingerprint,
          JSON.stringify({ verdict: "fail", decisionId: item.id }), a.created_at, a.created_at);
    });
    rehearsal.tick();
    expect(waiver(rehearsal, head)).toBeNull();
    expect(rehearsal.github.issues).toEqual([]);
    expect(mainHead(rehearsal)).not.toBe(head);
    expect(rehearsal.sessions()).toHaveLength(2);
    expect(repairs(rehearsal).map((row) => [row.role, row.outcome])).toEqual([["qa", "launched"]]);
  });
});
