import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { createReviewItem } from "../src/db/repositories.js";
import {
  ensureQaPlanWaiver,
  ensureQaPlanWaiverTable,
  getQaPlanWaiver,
  independentVerdictGateWithQaPlanWaiver,
  MAX_QA_PLAN_ISSUE_ATTEMPTS,
  qaPlanSoleFailure,
  qaPlanSoleFailureOnHead
} from "../src/production/independentReview.js";
import { classifyRecoverySignals } from "../src/production/recoverySignals.js";
import { attemptReviewRepair } from "../src/production/reviewRepair.js";
import { getSession, type AgentSession } from "../src/sessions/index.js";
import { independentVerdictReadiness, requirementForSession } from "../src/sessions/roleLineage.js";
import { launchedRepairRounds, listReviewRepairs } from "../src/sessions/reviewRepair.js";
import { git, LINE_A, Rehearsal, type RehearsalOptions } from "./helpers/rehearsalHarness.js";

/**
 * Decision 0169: a QA verdict whose only failure is the host-written Operator
 * QA plan (which no repair Session can change) spends no repair round, stops
 * blocking that head, records one operator check step as unverified and
 * requests one Issue. Real tick over the shared rehearsal fixture; only the
 * GitHub CLI (including `gh issue create`, the injected runner) and the
 * reviewer model are stubbed. Shapes are classified by the recovery-signal
 * classifier (src/production/recoverySignals.ts).
 */
// `consumedCompletionDrafts` can be made to throw, to prove the waiver fails closed.
const consumed = vi.hoisted(() => ({ fail: false }));
vi.mock("../src/production/workerMerge.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/production/workerMerge.js")>();
  return { ...original, consumedCompletionDrafts: (...args: Parameters<typeof original.consumedCompletionDrafts>) => {
    if (consumed.fail) throw new Error("git failed");
    return original.consumedCompletionDrafts(...args);
  } };
});

const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const PLAN_TITLE = "Operator QA step 4 uses the wrong evidence for acceptance criterion 1";

interface Options {
  /** What the stubbed QA reviewer fails; null passes every QA criterion (no QA verdict failure at all). */
  qaFails?: string[] | null;
  qaFindingTitle?: string;
  /** Skip the QA tick: stop with code review passed and QA not yet run. */
  stopBeforeQa?: boolean;
  /** The reviewer finding's severity and the verdict summary. */
  qaSeverity?: string;
  qaSummary?: string;
  /** Extra files the candidate changes beside MARKER.md. */
  files?: Record<string, string>;
  rehearsal?: RehearsalOptions;
}

/** Action A preserved, readied, code review passed; with `stopBeforeQa` false the QA tick has run too. */
function reviewed(options: Options = {}, track = true): { rehearsal: Rehearsal; a: AgentSession; head: string } {
  const rehearsal = new Rehearsal({ independentReviewers: "tick", ...options.rehearsal });
  if (track) rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  const a = rehearsal.lease()!;
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  for (const [file, content] of Object.entries(options.files ?? {})) rehearsal.agentEdit(a, file, content);
  rehearsal.agentFinish(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  rehearsal.github.findingSeverity = options.qaSeverity ?? "medium";
  rehearsal.github.failSummary = options.qaSummary ?? "The Operator QA plan does not match the criterion.";
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
    expect(row.record).toContain("named one numbered plan step, so one operator check step (Step 4) went unverified and QA no longer blocks this head (Decision 0169)");
    expect(row.verdict_request_id).toBe(qaAttempts(rehearsal)[0].request_id);
    expect(rehearsal.log.some((line) => line.includes(row.record))).toBe(true);
    const journey = withReadOnlyDatabase(rehearsal.workspace, (db) =>
      db.prepare("SELECT kind, message FROM action_journey_log WHERE action_key = ? AND kind = 'qa_plan_unverified'").all(rehearsal.actionA)) as Array<{ message: string }>;
    expect(journey.map((entry) => entry.message)).toEqual([row.record]);
    // The same facts through the classifier the signals use.
    expect(classifyRecoverySignals({ reviewRepairs: [{ requestId: "r", actionKey: "a/b", round: 1, role: "qa", verdict: "fail", outcome: "x", at: "2026-11-02T00:00:00Z",
      failedChecks: [{ criterion: "operator-qa-plan", status: "fail" }] }] }).map((signal) => signal.failureClass)).toEqual(["sole_failure"]);
  });

  it("lands through the worker pull-request merge (the live mode), pinned to the reviewed head, with the record and one Issue", () => {
    const { rehearsal, head } = reviewed({ rehearsal: { workerMerge: true } });
    expect(rehearsal.github.mergeCalls.map((call) => [call.matchHead, call.merged])).toEqual([[head, true]]);
    expect(rehearsal.github.prs[0].state).toBe("MERGED");
    expect(repairs(rehearsal)).toEqual([]);
    expect(rehearsal.sessions()).toHaveLength(1);
    expect(qaAttempts(rehearsal).map((attempt) => attempt.status)).toEqual(["failed"]);
    expect(waiver(rehearsal, head)?.record).toContain("one operator check step (Step 4) went unverified");
    expect(rehearsal.github.issues).toHaveLength(1);
  });

  it("keeps blocking, with an accurate reason, while the unverified-step record cannot be written, and lands once it can", () => {
    const { rehearsal, head } = reviewed({ stopBeforeQa: true });
    const unwritable = (on: boolean) => withDatabase(rehearsal.workspace, (db) => {
      ensureQaPlanWaiverTable(db);
      db.exec(on
        ? "CREATE TRIGGER IF NOT EXISTS qa_plan_waiver_unwritable BEFORE INSERT ON production_qa_plan_waivers BEGIN SELECT RAISE(ABORT, 'unwritable'); END;"
        : "DROP TRIGGER IF EXISTS qa_plan_waiver_unwritable");
    });
    unwritable(true);
    const blocked = () => rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA);
    rehearsal.tick(); // QA runs and fails only the plan; the record cannot be written
    expect(qaAttempts(rehearsal).map((attempt) => attempt.status)).toEqual(["failed"]);
    expect(blocked()).toMatchObject({ kind: "independent_verdict_failed", message: expect.stringContaining("record could not be written") });
    expect(mainHead(rehearsal)).not.toBe(head);
    rehearsal.tick(); // the already-recorded failed verdict is met again: still blocked
    expect(blocked()).toMatchObject({ kind: "independent_verdict_failed" });
    expect(mainHead(rehearsal)).not.toBe(head);
    expect(rehearsal.sessions()).toHaveLength(1); // no repair Session, no repair row
    expect(repairs(rehearsal)).toEqual([]);
    expect(waiver(rehearsal, head)).toBeNull();
    expect(rehearsal.github.issues).toEqual([]);
    unwritable(false);
    rehearsal.tick();
    expect(mainHead(rehearsal)).toBe(head);
    expect(waiver(rehearsal, head)?.record).toContain("one operator check step (Step 4) went unverified");
  });

  it("requests one Issue per Action and head through the injected runner, and a replay requests no second", () => {
    const { rehearsal, a, head } = reviewed();
    expect(rehearsal.github.issues).toHaveLength(1);
    const [issue] = rehearsal.github.issues;
    expect(issue.title).toBe(`QA verdict failed only the Operator QA plan: ${rehearsal.actionA} at ${head.slice(0, 12)}`);
    expect(issue.body).toContain(`Operator QA plan unverified for ${rehearsal.actionA} at ${head}`);
    expect(issue.body).toContain("one operator check step (Step 4) went unverified");
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
    rehearsal.github.findingSeverity = "medium";
    rehearsal.github.failSummary = "The Operator QA plan does not match the criterion.";
    rehearsal.github.failCriteria = ["operator-qa-plan"];
    rehearsal.github.findingTitle = PLAN_TITLE;
    for (let i = 0; i < 4; i += 1) rehearsal.tick();
    return { rehearsal, a, head: git(rehearsal.repo, ["rev-parse", `refs/heads/${a.branch}`]).trim() };
  };

  it("logs a failure to file the Issue without changing the verdict outcome", () => {
    const control = reviewed();
    const failing = reviewedWithIssueFailures(["HTTP 502: bad gateway", "HTTP 502: bad gateway", "HTTP 502: bad gateway"]);
    // The same outcome as when filing works: the head lands, no repair, no draft.
    expect(mainHead(failing.rehearsal)).toBe(failing.head);
    expect(mainHead(control.rehearsal)).toBe(control.head);
    expect(failing.rehearsal.sessions()).toHaveLength(control.rehearsal.sessions().length);
    expect(repairs(failing.rehearsal)).toEqual([]);
    expect(failing.rehearsal.github.undoReadyCalls).toEqual([]);
    expect(failing.rehearsal.github.issues).toEqual([]);
    // One attempt only: both gate calls of the landing tick share the tick's time.
    const row = waiver(failing.rehearsal, failing.head)!;
    expect(row).toMatchObject({ issue_url: null, issue_error: "HTTP 502: bad gateway", issue_attempts: 1 });
    expect(failing.rehearsal.log.some((line) => line.includes("Filing the Issue for the unverified Operator QA plan") && line.includes("the verdict outcome is unchanged: HTTP 502: bad gateway"))).toBe(true);
    // The unverified record is written whether or not the Issue could be filed.
    expect(row.record).toContain("one operator check step (Step 4) went unverified");
  });

  it("redacts secrets in the evidence it puts in the Issue", () => {
    const { rehearsal, a } = reviewed({ stopBeforeQa: true });
    const github = rehearsal.github;
    const key = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";
    withDatabase(rehearsal.workspace, (db) => {
      const session = getSession(db, a.id)!;
      const failure = { attempt: { request_id: "r" } as never, head: "h".repeat(40), pullRequestUrl: "https://github.com/pmark/rehearsal/pull/7", summary: "s", reportPath: null,
        planEvidence: `Step 4 shows token=${key}`, findings: [{ severity: "medium", title: "Operator QA step 4", evidence: `key ${key}`, recommendation: "r" }] };
      ensureQaPlanWaiver(db, { session, failure, now: rehearsal.now, cwd: rehearsal.repo, runCommand: github.runCommand });
    });
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0].body).not.toContain(key);
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

  // Decision 0169 did not lift Decision 0098's gate list: a candidate changing launch-authority code stays gated.
  it.each([false, true])("when the candidate is on Decision 0098's gate list (src/production/policy.ts), under worker merge %s", (workerMerge) => {
    const { rehearsal, head } = reviewed({ files: { "src/production/policy.ts": "export const gated = true;\n" }, rehearsal: { workerMerge } });
    expect(repairs(rehearsal).map((row) => [row.role, row.outcome])).toEqual([["qa", "gated"]]);
    expect(repairs(rehearsal)[0].reason).toContain("Decision 0098's gate list");
    expect(rehearsal.sessions()).toHaveLength(1);
    expect(mainHead(rehearsal)).not.toBe(head);
    expect(rehearsal.github.mergeCalls).toEqual([]);
    expect(rehearsal.github.prs[0].isDraft).toBe(true);
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
    rehearsal.github.findingSeverity = "medium";
    rehearsal.github.failSummary = "The Operator QA plan does not match the criterion.";
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
    attemptHead?: string;
    criteriaFingerprint?: string;
    evidenceFingerprint?: string;
    effectiveness?: unknown;
    residualRisks?: string[];
  }
  const PLAN_FAIL = { criterion: "operator-qa-plan", name: "Operator QA plan", status: "fail", evidence: "Step 4 inspects the wrong file." };
  const OTHERS = ["correctness", "scope-fidelity", "approval-boundaries", "managed-documents", "hidden-consequences", "tests-and-evidence"].map((criterion) => ({
    criterion, name: criterion, status: "pass", evidence: "ok"
  }));
  const PLAN_FINDING = { severity: "medium", title: PLAN_TITLE, evidence: "Step 4 inspects the wrong file.", recommendation: "Inspect the test file." };
  const planFinding = (over: Partial<typeof PLAN_FINDING>) => ({ ...PLAN_FINDING, ...over });
  /** A plan check whose own evidence names no step, so only the finding's wording is under test. */
  const noStep0 = { ...PLAN_FAIL, evidence: "The plan is not concrete." };
  const noStep = [noStep0, ...OTHERS];

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
          summary: "seeded summary", findings: input.findings ?? [PLAN_FINDING], checks: input.checks ?? [PLAN_FAIL, ...OTHERS], residualRisks: input.residualRisks ?? [],
          effectiveness: "effectiveness" in input ? input.effectiveness : { deterministicGateReasons: [], deterministicGateVerdict: "pass" },
          role: input.role ?? "qa", reportPath: "artifacts/qa/seeded.md", ...input.context
        }
      });
      const requirement = requirementForSession(rehearsal.repo, session)!;
      const role = input.attemptRole ?? "qa";
      db.prepare(`INSERT INTO session_role_attempts (id, requirement_id, input_revision, role, ordinal, request_id, actor_id, mutation_owner, status,
        target_head, criteria_fingerprint, evidence_fingerprint, terminal_receipt_json, created_at, updated_at)
        VALUES ('seeded-attempt', ?, ?, ?, ?, 'seeded-attempt', 'seeded-independent-reviewer', 0, ?, ?, ?, ?, ?, ?, ?)`)
        .run(requirement.requirementId, requirement.inputRevision, role, role === "qa" ? 1 : 2, input.attemptStatus ?? "failed",
          input.attemptHead ?? head, input.criteriaFingerprint ?? readiness.binding.criteriaFingerprint, input.evidenceFingerprint ?? readiness.binding.evidenceFingerprint,
          JSON.stringify({ verdict: "fail", decisionId: item.id, ...input.receipt }), a.created_at, a.created_at);
    });
  }
  function unseed(): void {
    withDatabase(shared.rehearsal.workspace, (db) => {
      db.prepare("DELETE FROM session_role_attempts WHERE id = 'seeded-attempt'").run();
      ensureQaPlanWaiverTable(db);
      db.prepare("DELETE FROM production_qa_plan_waivers").run();
    });
    shared.rehearsal.github.issues.length = 0;
    shared.rehearsal.github.issueFailures.length = 0;
  }
  const ask = (runCommand = shared.rehearsal.github.runCommand) => withDatabase(shared.rehearsal.workspace, (db) =>
    independentVerdictGateWithQaPlanWaiver(db, { session: getSession(db, shared.a.id)!, repoRoot: shared.rehearsal.repo, now: shared.rehearsal.now, runCommand }));
  const waived = () => withDatabase(shared.rehearsal.workspace, (db) => qaPlanSoleFailureOnHead(db, { session: getSession(db, shared.a.id)!, repoRoot: shared.rehearsal.repo }));
  afterEach(unseed);
  const askAt = (now: Date, runCommand = shared.rehearsal.github.runCommand) => withDatabase(shared.rehearsal.workspace, (db) =>
    independentVerdictGateWithQaPlanWaiver(db, { session: getSession(db, shared.a.id)!, repoRoot: shared.rehearsal.repo, now, runCommand }));
  const minutes = (n: number) => new Date(shared.rehearsal.now.getTime() + n * 60_000);

  it("spends at most one filing attempt per tick, retries on a later tick and files exactly one Issue", () => {
    seed({});
    shared.rehearsal.github.issueFailures = ["HTTP 502: bad gateway"];
    expect(askAt(minutes(0))).toMatchObject({ satisfied: true });
    expect(waiver(shared.rehearsal, shared.head)).toMatchObject({ issue_attempts: 1, issue_error: "HTTP 502: bad gateway", issue_url: null });
    askAt(minutes(0)); // the tick's second gate call
    expect(waiver(shared.rehearsal, shared.head)!.issue_attempts).toBe(1);
    expect(askAt(minutes(1))).toMatchObject({ satisfied: true });
    expect(waiver(shared.rehearsal, shared.head)).toMatchObject({ issue_attempts: 2, issue_error: null, issue_url: expect.stringContaining("/issues/") });
    askAt(minutes(2));
    askAt(minutes(2));
    expect(shared.rehearsal.github.issues).toHaveLength(1);
  });

  it("searches for an existing Issue only on a retry, and requests the body to verify the marker", () => {
    seed({});
    const lists = () => shared.rehearsal.github.ghCalls.filter((call) => call.startsWith("gh issue list"));
    const before = lists().length;
    askAt(minutes(0));
    expect(lists().length - before).toBe(0); // the common path makes no search
    withDatabase(shared.rehearsal.workspace, (db) => db.prepare("UPDATE production_qa_plan_waivers SET issue_url = NULL").run());
    askAt(minutes(1));
    expect(lists().length - before).toBe(1);
    expect(lists().at(-1)).toContain("--json number,url,body");
  });

  it("adopts only an Issue whose body carries the marker, and never creates after a failed search", () => {
    seed({});
    const run = shared.rehearsal.github.runCommand;
    askAt(minutes(0));
    const created = () => shared.rehearsal.github.issues.length;
    withDatabase(shared.rehearsal.workspace, (db) => db.prepare("UPDATE production_qa_plan_waivers SET issue_url = NULL").run());
    // A search hit that is not ours (no marker in its body) is not adopted: a new Issue is filed.
    const unrelated: typeof run = (input) => input.args[1] === "list"
      ? { status: 0, stdout: JSON.stringify([{ number: 1, url: "https://github.com/pmark/rehearsal/issues/1", body: "unrelated" }]), stderr: "", error: null }
      : run(input);
    askAt(minutes(1), unrelated);
    expect(created()).toBe(2);
    expect(waiver(shared.rehearsal, shared.head)!.issue_url).not.toBe("https://github.com/pmark/rehearsal/issues/1");
    // A failing search is a failed attempt: no Issue is created blind, the error says why.
    withDatabase(shared.rehearsal.workspace, (db) => db.prepare("UPDATE production_qa_plan_waivers SET issue_url = NULL").run());
    const failing: typeof run = (input) => input.args[1] === "list" ? { status: 1, stdout: "", stderr: "HTTP 500 on search", error: null } : run(input);
    askAt(minutes(2), failing);
    expect(created()).toBe(2);
    expect(waiver(shared.rehearsal, shared.head)).toMatchObject({ issue_url: null, issue_error: expect.stringContaining("could not check for an existing Issue: HTTP 500 on search") });
  });

  it("refuses a head whose last commit writes more than settlement records", () => {
    // The pre-settlement commit changes MARKER.md: the same seeded verdict on that commit is not a settled head.
    const settledHead = shared.head;
    const agentHead = git(shared.rehearsal.repo, ["rev-parse", `${settledHead}^1`]).trim();
    seed({ attemptHead: agentHead, context: { candidate: { headSha: agentHead, url: "https://github.com/pmark/rehearsal/pull/7" } } });
    const verdict = (head: string) => withDatabase(shared.rehearsal.workspace, (db) => {
      const session = getSession(db, shared.a.id)!;
      const readiness = independentVerdictReadiness(db, { session, repoRoot: shared.rehearsal.repo });
      if (!readiness.ready) throw new Error("not ready");
      return qaPlanSoleFailure(db, session, { requirement: readiness.requirement, binding: { ...readiness.binding, targetHead: head } }, head, shared.rehearsal.repo);
    });
    expect(verdict(agentHead)).toBeNull();
  });

  it("accepts a head whose last commit writes a Plan record but refuses one that adds an unconsumed ask file", () => {
    const repo = shared.rehearsal.repo;
    const on = (file: string) => {
      // A commit on top of the pre-settlement commit that adds one file, built with plumbing (no checkout).
      const index = path.join(shared.rehearsal.root, `index-${file.replaceAll("/", "_")}`);
      const env = { ...process.env, GIT_INDEX_FILE: index };
      const run = (args: string[], input?: string) => execFileSync("git", args, { cwd: repo, env, input, encoding: "utf8" }).trim();
      const parent = run(["rev-parse", `${shared.head}^1`]); // the pre-settlement commit, so only `file` differs from it
      run(["read-tree", parent]);
      const blob = run(["hash-object", "-w", "--stdin"], "x\n");
      run(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`]);
      return run(["-c", "user.name=T", "-c", "user.email=t@example.test", "commit-tree", run(["write-tree"]), "-p", parent, "-m", "extra"]);
    };
    const judge = (head: string) => {
      seed({ attemptHead: head, context: { candidate: { headSha: head, url: "https://github.com/pmark/rehearsal/pull/7" } } });
      try {
        return withDatabase(shared.rehearsal.workspace, (db) => {
          const session = getSession(db, shared.a.id)!;
          const readiness = independentVerdictReadiness(db, { session, repoRoot: repo });
          if (!readiness.ready) throw new Error("not ready");
          return qaPlanSoleFailure(db, session, { requirement: readiness.requirement, binding: { ...readiness.binding, targetHead: head } }, head, repo);
        });
      } finally { unseed(); }
    };
    expect(judge(on("docs/plans/extra-plan.md"))).not.toBeNull();
    expect(judge(on(".arcadia/asks/rogue.yaml"))).toBeNull();
    expect(judge(on("src/extra.ts"))).toBeNull();
  });

  describe("a host-settled head with a consumed completion draft (the live shape)", () => {
    const repo = () => shared.rehearsal.repo;
    /** A commit on `parent` that adds and removes the given files, built with plumbing (no checkout). */
    const commit = (parent: string, add: Record<string, string>, remove: string[] = []) => {
      const index = path.join(shared.rehearsal.root, `index-${Math.random().toString(36).slice(2)}`);
      const env = { ...process.env, GIT_INDEX_FILE: index };
      const run = (args: string[], input?: string) => execFileSync("git", args, { cwd: repo(), env, input, encoding: "utf8" }).trim();
      run(["read-tree", parent]);
      for (const [file, content] of Object.entries(add)) run(["update-index", "--add", "--cacheinfo", `100644,${run(["hash-object", "-w", "--stdin"], content)},${file}`]);
      for (const file of remove) run(["update-index", "--force-remove", file]);
      return run(["-c", "user.name=T", "-c", "user.email=t@example.test", "commit-tree", run(["write-tree"]), "-p", parent, "-m", "x"]);
    };
    const draft = (revision: string) => `agent_ask: v1\nrequest_id: consumed-draft\ncandidate_revision: ${revision}\n`;
    /** pre-settlement commit + the candidate's draft, then a settlement commit that archives it: `D draft`, `A archive/draft`. */
    const settled = () => {
      const agent = execFileSync("git", ["rev-parse", `${shared.head}^1`], { cwd: repo(), encoding: "utf8" }).trim();
      const withDraft = commit(agent, { ".arcadia/asks/agent-ask-consumed.yaml": draft("aaaaaaa") });
      return commit(withDraft, { ".arcadia/asks/archive/agent-ask-consumed.yaml": draft("bbbbbbb") }, [".arcadia/asks/agent-ask-consumed.yaml"]);
    };
    const judge = (head: string) => {
      seed({ attemptHead: head, context: { candidate: { headSha: head, url: "https://github.com/pmark/rehearsal/pull/7" } } });
      try {
        return withDatabase(shared.rehearsal.workspace, (db) => {
          const session = getSession(db, shared.a.id)!;
          const readiness = independentVerdictReadiness(db, { session, repoRoot: repo() });
          if (!readiness.ready) throw new Error("not ready");
          return qaPlanSoleFailure(db, session, { requirement: readiness.requirement, binding: { ...readiness.binding, targetHead: head } }, head, repo());
        });
      } finally { unseed(); }
    };

    it("waives it: the draft's deletion is the candidate's own consumed draft", () => {
      expect(judge(settled())).not.toBeNull();
    });

    it("fails closed when reading the consumed drafts throws", () => {
      const head = settled();
      consumed.fail = true;
      try { expect(judge(head)).toBeNull(); } finally { consumed.fail = false; }
      expect(judge(head)).not.toBeNull();
    });
  });

  it("files against the repository named by the pull request URL, marks the Issue, and adopts an Issue that already carries the marker", () => {
    seed({});
    askAt(minutes(0));
    const [issue] = shared.rehearsal.github.issues;
    expect(issue.repo).toBe("pmark/rehearsal");
    expect(shared.rehearsal.github.ghCalls.some((call) => call.startsWith("gh issue create --repo pmark/rehearsal "))).toBe(true);
    expect(issue.body).toContain(`<!-- qa-plan-unverified:${shared.rehearsal.actionA}:${shared.head} -->`);
    // A crash after `gh issue create` but before the row was updated: the next attempt adopts the Issue.
    withDatabase(shared.rehearsal.workspace, (db) => db.prepare("UPDATE production_qa_plan_waivers SET issue_url = NULL").run());
    askAt(minutes(1));
    expect(shared.rehearsal.github.issues).toHaveLength(1);
    expect(waiver(shared.rehearsal, shared.head)).toMatchObject({ issue_url: issue.url, issue_attempts: 2 });
  });

  it("stops asking GitHub after the attempt bound", () => {
    seed({});
    shared.rehearsal.github.issueFailures = ["x", "x", "x", "x"];
    const lists = () => shared.rehearsal.github.ghCalls.filter((call) => call.startsWith("gh issue list")).length;
    const before = lists();
    for (let n = 0; n < MAX_QA_PLAN_ISSUE_ATTEMPTS + 2; n += 1) askAt(minutes(n));
    expect(waiver(shared.rehearsal, shared.head)).toMatchObject({ issue_attempts: MAX_QA_PLAN_ISSUE_ATTEMPTS, issue_url: null });
    expect(lists() - before).toBe(MAX_QA_PLAN_ISSUE_ATTEMPTS - 1); // a search only on a retry
  });

  it("the plain sole-failure shape is waived by the gate, with the record and one Issue", () => {
    seed({});
    expect(waived()).toMatchObject({ head: shared.head });
    expect(ask()).toMatchObject({ satisfied: true });
    expect(waiver(shared.rehearsal, shared.head)?.record).toContain("one operator check step (Step 4) went unverified");
    expect(shared.rehearsal.github.issues).toHaveLength(1);
  });

  const waivable: Array<[string, Seed]> = [
    ["one medium plan finding naming one step (the shape of #1996 to #1998)", {}],
    ["one low plan finding", { findings: [planFinding({ severity: "low" })] }],
    ["zero findings and plan evidence naming exactly one step", { findings: [], checks: [{ ...PLAN_FAIL, evidence: "Step 4 inspects the wrong file." }, ...OTHERS] }],
    ["the same step named repeatedly", { findings: [planFinding({ evidence: "Step 4 is wrong; fix Step 4. Step 4 again." })] }],
    ["a step named in words or with a hash", { findings: [planFinding({ evidence: "Step four, also written Step #4, is wrong." })] }],
    // Real ledger text (martianrover, QA reports for PR #5 and PR #2): text about the plan, not the code.
    ["the real #5 shape: 'the operator QA procedure incorrectly claims', one step", {
      findings: [planFinding({ title: "Operator QA step 4 does not prove its stated acceptance criterion", evidence: "Step 4 only runs `git show ...:scripts/check-rehearsal.mjs`, yet its expected result says that displayed source proves the check passes. Source display cannot establish a successful execution.", recommendation: "Make Step 4 a source-inspection step only." })],
      checks: [{ ...PLAN_FAIL, evidence: "The procedure is mostly concrete, but Step 4 falsely treats source display as proof that an executable check passes." }, ...OTHERS],
      context: { summary: "The implementation and supplied validation support the marker change, but the operator QA procedure incorrectly claims static source inspection proves that the executable check passes." },
      residualRisks: ["The operator procedure should be corrected before relying on it as a criterion-by-criterion audit record."]
    }],
    ["a summary describing an operator following the procedure", { context: { summary: "An operator following the supplied procedure would stop at Step 4." } }],
    ["a residual risk starting with Following", { residualRisks: ["Following the operator plan would inspect Step 4."] }],
    ["a summary using later and other than without steps", { context: { summary: "Step 4 is wrong and should be fixed later. Other than the plan, the change is fine." } }],
    ["the same step named in the summary and a residual risk", { context: { summary: "Step 4 of the operator QA plan is wrong." }, residualRisks: ["Step 4 should be rewritten."] }],
    ["a residual risk that mentions a bug fix", { residualRisks: ["The bug fix itself is covered by a test."] }],
    ["a summary that mentions a bug fix", { context: { summary: "Step 4 is wrong; the bug fix itself is described correctly." } }],
    ["the real #1661/#1786 summary wording about a regression test", { context: { summary: "The regression test is logically aligned with the stated acceptance criteria, but the operator QA plan targets a predecessor commit and an incorrect file list." }, residualRisks: ["The new regression test may not have been executed by the specifically requested command."] }],
    ["plan text that fails to run, is broken or names an incorrect path", { findings: [planFinding({ evidence: "Step 4's command fails to run: the path it names is incorrect and the inspection is broken." })] }]
  ];
  it.each(waivable)("waives %s", (_name, input) => {
    seed(input);
    expect(waived()).not.toBeNull();
    expect(ask()).toMatchObject({ satisfied: true });
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
    ["the report lists no checks", { checks: [] }],
    // F2: severity, prose and claims about the candidate
    ["a plan-titled finding is a blocker", { findings: [planFinding({ severity: "blocker" })] }],
    ["a plan-titled finding is high", { findings: [planFinding({ severity: "high" })] }],
    ["a plan-titled finding has an unknown severity", { findings: [planFinding({ severity: "catastrophic" })] }],
    ["a plan-titled blocker's evidence names a code defect", { findings: [planFinding({ severity: "blocker", title: "Operator QA step 3 fails: the candidate drops the users table", evidence: "The migration drops the users table." })] }],
    ["a plan-titled medium finding's evidence claims the candidate drops a table", { findings: [planFinding({ evidence: "Step 4 passes, but the migration drops the users table." })] }],
    ["a plan-titled finding's recommendation claims a defect", { findings: [planFinding({ recommendation: "Fix the bug in the code." })] }],
    ["zero findings and the plan evidence says the code is wrong", { findings: [], checks: [{ ...PLAN_FAIL, evidence: "Step 4 is fine but the code is wrong." }, ...OTHERS] }],
    ["the summary states data loss", { context: { summary: "Operator QA step 4 is wrong and the change causes data loss." } }],
    ["a residual risk states a defect", { residualRisks: ["The candidate may corrupt stored data."] }],
    ["the plan evidence names a failure of the candidate", { checks: [{ ...PLAN_FAIL, evidence: "The candidate fails to refuse a stale head." }, ...OTHERS] }],
    // F3: one operator check step only
    ["there are two findings, both titled about the plan", { findings: [PLAN_FINDING, planFinding({ title: "Operator QA step 4 expects the wrong output" })] }],
    ["a finding names step 3 and the plan evidence names step 4", { findings: [planFinding({ title: "Operator QA step 3 inspects the wrong file", evidence: "Step 3 inspects the wrong file." })] }],
    ["zero findings and the plan evidence names Steps 4 and 6", { findings: [], checks: [{ ...PLAN_FAIL, evidence: "Steps 4 and 6 prescribe inspections that cannot establish their results." }, ...OTHERS] }],
    ["the plan evidence names a range of steps", { findings: [], checks: [{ ...PLAN_FAIL, evidence: "Steps 1-5 are not runnable." }, ...OTHERS] }],
    ["five high findings across steps 1 to 5", { findings: [1, 2, 3, 4, 5].map((n) => planFinding({ severity: "high", title: `Operator QA step ${n} is not runnable`, evidence: `Step ${n} is not runnable.` })) }],
    ["a summary says the code is broken beside plan words", { context: { summary: "The operator QA procedure is fine but the code is broken." } }],
    ["a finding says the candidate has a bug", { findings: [planFinding({ evidence: "Step 4 is fine, but the candidate has a bug in the guard." })] }],
    ["the summary says the implementation removes a check", { context: { summary: "Step 4 is fine but the implementation removes the stale-head check." } }],
    // N3: one numbered step, in every spelling
    ["steps named in words", { findings: [planFinding({ evidence: "Step four and step six are wrong." })], checks: noStep }],
    ["steps named with hashes", { findings: [planFinding({ evidence: "Step #4 and Step #6 are wrong." })], checks: noStep }],
    ["steps named as ordinals", { findings: [planFinding({ evidence: "The third and fifth steps are wrong." })], checks: noStep }],
    ["a numbered list of steps", { findings: [planFinding({ evidence: "Wrong:\n1. inspect the file\n2. run the check" })], checks: noStep }],
    ["two acceptance criteria", { findings: [planFinding({ evidence: "Step 4 cannot show acceptance criteria 2 and 4." })], checks: noStep }],
    ["every step", { findings: [planFinding({ evidence: "Every step of the plan is wrong." })], checks: noStep }],
    ["none of the inspections", { findings: [planFinding({ evidence: "None of the inspections in Step 4 shows the result." })], checks: noStep }],
    ["all steps in the plan evidence", { findings: [], checks: [{ ...PLAN_FAIL, evidence: "All steps are vague." }, ...OTHERS] }],
    // R1: a wholly missing plan, or a plan naming no step, is not "one operator check step unverified"
    ["zero findings and plan evidence naming no step", { findings: [], checks: [noStep0, ...OTHERS] }],
    ["a finding titled Missing operator QA plan", { findings: [planFinding({ title: "Missing operator QA plan", evidence: "There is no operator procedure." })], checks: [noStep0, ...OTHERS] }],
    ...[
      "The whole procedure is unrunnable.", "Several steps cannot run.", "Multiple steps cannot run.", "Most steps cannot run.", "All acceptance steps cannot run.",
      "Both inspection steps cannot run.", "Neither the fourth nor the sixth step can run.", "Wrong:\na) inspect the file\nb) run the check\nc) compare", "Wrong:\n- inspect the file\n- run the check"
    ].flatMap((text): Array<[string, Seed]> => [
      [`unnumbered "${text.split("\n")[0]}" with no step named`, { findings: [planFinding({ title: "Operator QA plan is unrunnable", evidence: text })], checks: [noStep0, ...OTHERS] }],
      [`unnumbered "${text.split("\n")[0]}" beside Step 4`, { findings: [planFinding({ evidence: `Step 4 is wrong. ${text}` })] }]
    ]),
    // R3: the bare "Step N" title never mentions the plan
    // The summary and residual risks count too: a second step, or the whole plan, refuses
    ["the summary names a second step", { context: { summary: "Step 4 is wrong and Step 6 fails too." } }],
    ["a residual risk names a second step", { residualRisks: ["Step 5 may also be unrunnable."] }],
    ["the summary speaks of every step", { context: { summary: "Every step of the operator QA plan is vague." } }],
    ["a residual risk speaks of the remaining steps", { residualRisks: ["Step 4 is wrong, as are the remaining steps."] }],
    // "The candidate has a bug", in a summary or a residual risk (where "bug fix" stays ordinary)
    ["the summary says the candidate has a bug", { context: { summary: "Step 4 is wrong and the candidate has a bug in the guard." } }],
    ["the summary says the code contains a defect", { context: { summary: "The code contains a defect; Step 4 is wrong." } }],
    ["a residual risk says there is a bug in the patch", { residualRisks: ["There is a bug in the patch."] }],
    ["a residual risk says the implementation has a defect", { residualRisks: ["The implementation may have a defect."] }],
    ["the summary stretches the step over the following steps", { context: { summary: "Step 4 and the following steps cannot run." } }],
    ["the summary stretches the step over the following two steps", { context: { summary: "Step 4 and the following two steps cannot run." } }],
    ["a residual risk says the others share the problem", { residualRisks: ["Step 4 is representative; the others share the problem."] }],
    // A1 again, in the plan check's own evidence (strict)
    ...[
      "Step 4 and the following steps cannot run.", "Step 4 onward cannot run.", "Step 4 through the end cannot run.", "Step 4 fails, as do later steps.",
      "Step 4 is representative; the others share the problem.", "Only step 4 is runnable.", "Other than step 4 the procedure does not run."
    ].map((text): [string, Seed] => [`one step stretched over the rest in the plan evidence: "${text}"`, { checks: [{ ...PLAN_FAIL, evidence: text }, ...OTHERS] }]),
    // A1: wording that stretches one named step over the rest of the plan
    ...[
      "Step 4 and the following steps cannot run.", "Step 4 onward cannot run.", "Step 4 through the end cannot run.", "Step 4 fails, as do later steps.",
      "Step 4 is representative; the others share the problem.", "Only step 4 is runnable.", "Other than step 4 the procedure does not run."
    ].map((text): [string, Seed] => [`one step stretched over the rest: "${text}"`, { findings: [planFinding({ evidence: text })] }]),
    ["a bare Step N title", { findings: [planFinding({ title: "Step 3: the guard is wrong", evidence: "Step 4 is wrong." })] }],
    ["a bare Step N title that makes no other claim", { findings: [planFinding({ title: "Step 4: the output is vague", evidence: "Step 4 is vague." })] }],
    ["a bare Step N title about the guard", { findings: [planFinding({ title: "Step 4: the guard accepts a stale head", evidence: "Step 4 is wrong." })] }],
    // R2: the plan-word exemption is closed; defect words in findings and plan evidence
    ["the code at step 4 is broken", { findings: [planFinding({ evidence: "The code at step 4 is broken." })] }],
    ["the patch, per step 4, is incorrect", { findings: [planFinding({ evidence: "The patch, per step 4, is incorrect." })] }],
    ["the implementation in the plan step is wrong", { findings: [planFinding({ evidence: "The implementation in the plan step is wrong. Step 4." })] }],
    ["the migration in step 4 fails to apply", { findings: [planFinding({ evidence: "The migration in step 4 fails to apply." })] }],
    ["step 4: the guard accepts a stale head", { findings: [planFinding({ evidence: "Step 4: the guard accepts a stale head." })] }],
    ["a candidate inspected in a step whose output is wrong", { findings: [planFinding({ evidence: "The candidate is inspected in Step 4, whose expected output is wrong." })] }],
    ["a finding says bug", { findings: [planFinding({ evidence: "Step 4 hides a bug." })] }],
    ["the plan evidence says defect", { checks: [{ ...PLAN_FAIL, evidence: "Step 4 shows a defect." }, ...OTHERS] }],
    // F5: the deterministic gate
    ["the deterministic gate recorded a reason (merge state DIRTY)", { effectiveness: { deterministicGateReasons: ["the pull request merge state is DIRTY"], deterministicGateVerdict: "pass" } }],
    ["the deterministic gate recorded a verdict only", { effectiveness: { deterministicGateReasons: [], deterministicGateVerdict: "fail" } }],
    ["the report carries no effectiveness record", { effectiveness: undefined }],
    // T1: the attempt's binding
    ["the failed attempt is bound to another head", { attemptHead: "1".repeat(40) }],
    ["the failed attempt's criteria fingerprint changed on the same head", { criteriaFingerprint: "c".repeat(64) }],
    ["the failed attempt's evidence fingerprint changed on the same head", { evidenceFingerprint: "e".repeat(64) }]
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
