import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { runQaPrReviewCommand, type PrReviewRole, type QaPrReviewDependencies } from "../src/qa/prReview.js";
import { getSession, type AgentSession } from "../src/sessions/index.js";
import { beginIndependentVerdict, independentVerdictReadiness } from "../src/sessions/roleLineage.js";
import { git, HOST_REVIEW_PR_URL, HOST_REVIEWER_BINDING, hostReviewHost, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * The host command that records the exact-head code-review verdict
 * (`arcadia qa code-review`), and `arcadia qa pr` for QA, driven against a
 * real managed candidate of the hermetic rehearsal through the real tick.
 * Only GitHub and the read-only reviewer model are stubbed; the verdict
 * itself always comes from the host-run reviewer, never from the caller.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const PR_URL = HOST_REVIEW_PR_URL;
const REVIEWER_BINDING = HOST_REVIEWER_BINDING;

function waitingCandidate(): { rehearsal: Rehearsal; session: AgentSession; head: string } {
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
  const exited = rehearsal.tick();
  expect(exited.reconciled[0]?.outcome).toBe("accepted_completion");
  expect(exited.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/current independent verdicts/) });
  const session = withDatabase(rehearsal.workspace, (db) => getSession(db, a.id)!);
  const readiness = withDatabase(rehearsal.workspace, (db) => independentVerdictReadiness(db, { session, repoRoot: rehearsal.repo }));
  if (!readiness.ready) throw new Error(`candidate not ready: ${readiness.reasons.join(" ")}`);
  return { rehearsal, session, head: readiness.binding.targetHead };
}

const host = hostReviewHost;

function review(rehearsal: Rehearsal, role: PrReviewRole, dependencies: QaPrReviewDependencies, rerun = false) {
  return runQaPrReviewCommand({ workspace: rehearsal.workspace, pullRequest: PR_URL, role, rerun }, dependencies);
}

function verdictAttempts(rehearsal: Rehearsal, role: PrReviewRole) {
  return rehearsal.attempts("write-marker-a").filter((attempt) => attempt.role === role);
}

function escalation(rehearsal: Rehearsal) {
  return rehearsal.status().operatorEscalations.find((row) => row.actionKey === rehearsal.actionA);
}

const code = (fn: () => unknown) => {
  try { fn(); } catch (error) { return (error as { details?: { code?: string } }).details?.code ?? String(error); }
  return null;
};

describe("host-recorded exact-head code review", () => {
  it("records code review and QA through the host commands, and the tick integrates with no operator merge", () => {
    const { rehearsal, session, head } = waitingCandidate();
    const { calls, dependencies } = host(session, head);
    expect(escalation(rehearsal)).toMatchObject({ kind: "awaiting_independent_verdicts" });
    expect(escalation(rehearsal)?.remedy).toContain(`arcadia qa code-review ${"<the candidate's PR URL>"}`);
    expect(escalation(rehearsal)?.remedy).toContain("arcadia qa pr ");
    expect(escalation(rehearsal)?.remedy).toContain(`merge --ff-only ${head}`);

    const reviewed = review(rehearsal, "code-review", dependencies);
    expect(reviewed).toMatchObject({ command: "qa.codeReview", data: { verdict: "pass", reused: false, artifact: { artifact_type: "code_review_report" } } });
    expect(calls.prompts[0]).toContain("Exact-Head Code Review");
    expect(verdictAttempts(rehearsal, "code-review")).toEqual([
      expect.objectContaining({ ordinal: 1, status: "passed", actor_id: `code-review-reviewer:${REVIEWER_BINDING}`, target_head: head, mutation_owner: 0 })
    ]);

    // Transport replay: the same exact-head receipt, no second reviewer run and no second attempt.
    const replayed = review(rehearsal, "code-review", dependencies);
    expect(replayed.data).toMatchObject({ reused: true, decision: { id: reviewed.data.decision.id } });
    expect(calls.reviewer).toBe(1);
    expect(verdictAttempts(rehearsal, "code-review")).toHaveLength(1);

    // One verdict never integrates; the escalation now names only the missing QA command.
    expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");
    expect(escalation(rehearsal)?.remedy).toContain("arcadia qa pr ");
    expect(escalation(rehearsal)?.remedy).not.toContain("arcadia qa code-review");

    expect(review(rehearsal, "qa", dependencies)).toMatchObject({ command: "qa.pr", data: { verdict: "pass", artifact: { artifact_type: "qa_report" } } });
    expect(verdictAttempts(rehearsal, "qa")).toEqual([expect.objectContaining({ status: "passed", actor_id: `qa-reviewer:${REVIEWER_BINDING}`, target_head: head })]);

    const integrated = rehearsal.tick();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(head);
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-a")).toBe("done");
    expect(escalation(rehearsal)).toBeUndefined();
  });

  it("refuses a developer-run, stale-head or Off review before any reviewer runs, allocating nothing", () => {
    const { rehearsal, session, head } = waitingCandidate();
    const { calls, dependencies } = host(session, head);

    // The developer's own worktree is never the reviewer's working directory.
    const previous = process.cwd();
    try {
      process.chdir(session.worktree_path);
      expect(code(() => review(rehearsal, "code-review", dependencies))).toBe("independent_actor_required");
    } finally {
      process.chdir(previous);
    }
    // Nor its agent binding.
    const ownBinding = withDatabase(rehearsal.workspace, (db) =>
      (db.prepare("SELECT provider_binding_id FROM agent_sessions WHERE id = ?").get(session.id) as { provider_binding_id: string | null }).provider_binding_id);
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE agent_sessions SET provider_binding_id = ? WHERE id = ?").run(REVIEWER_BINDING, session.id));
    expect(code(() => review(rehearsal, "code-review", dependencies))).toBe("independent_actor_required");
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE agent_sessions SET provider_binding_id = ? WHERE id = ?").run(ownBinding, session.id));

    // A PR head other than the candidate's deterministically ready head.
    calls.prHead = "0".repeat(40);
    expect(code(() => review(rehearsal, "code-review", dependencies))).toBe("verdict_not_ready");
    calls.prHead = head;

    // Off withholds the reviewer entirely; the candidate stays preserved and waits.
    rehearsal.deactivate("off-before-code-review");
    expect(code(() => review(rehearsal, "code-review", dependencies))).toBe("managed_production_off");
    expect(code(() => review(rehearsal, "qa", dependencies))).toBe("managed_production_off");
    expect(calls.reviewer).toBe(0);
    expect(rehearsal.attempts("write-marker-a").filter((attempt) => attempt.role === "code-review" || attempt.role === "qa")).toEqual([]);

    // On again: the same candidate is reviewed and integrated.
    rehearsal.activate("reactivate-after-off-before-code-review");
    review(rehearsal, "code-review", dependencies);
    review(rehearsal, "qa", dependencies);
    expect(rehearsal.tick().handoff?.integration.kind).toBe("integrated");
  });

  it("never integrates a failed code review, and an authorized rerun allocates the next bounded ordinal", () => {
    const { rehearsal, session, head } = waitingCandidate();
    const model = { verdict: "fail" as "pass" | "fail" };
    const { calls, dependencies } = host(session, head, model);
    expect(review(rehearsal, "code-review", dependencies).data.verdict).toBe("fail");
    model.verdict = "pass";
    review(rehearsal, "qa", dependencies);
    expect(rehearsal.tick().handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/code-review: failed/) });
    expect(escalation(rehearsal)?.remedy).toContain("arcadia qa code-review");

    // Without --rerun the failed receipt is replayed, never re-judged.
    expect(review(rehearsal, "code-review", dependencies).data).toMatchObject({ verdict: "fail", reused: true });
    expect(calls.reviewer).toBe(2);

    expect(review(rehearsal, "code-review", dependencies, true).data.verdict).toBe("pass");
    expect(verdictAttempts(rehearsal, "code-review").map((attempt) => [attempt.ordinal, attempt.status])).toEqual([[1, "failed"], [2, "passed"]]);
    expect(rehearsal.tick().handoff?.integration.kind).toBe("integrated");
  });

  it("judges again instead of replaying a receipt whose verdict the candidate's new evidence made stale", () => {
    const { rehearsal, session, head } = waitingCandidate();
    const { calls, dependencies } = host(session, head);
    review(rehearsal, "code-review", dependencies);
    const receiptId = `worker-tick-preserve-${session.id}`;
    withDatabase(rehearsal.workspace, (db) => {
      const row = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?").get(receiptId) as { receipt_json: string };
      db.prepare("UPDATE candidate_preservation_receipts SET receipt_json = ? WHERE request_id = ?")
        .run(JSON.stringify({ ...JSON.parse(row.receipt_json), validationEvidenceRef: "re-validated-evidence.json" }), receiptId);
    });
    // The PR evidence is unchanged, but the old verdict no longer binds the candidate: no reuse, a superseding attempt.
    expect(review(rehearsal, "code-review", dependencies).data.reused).toBe(false);
    expect(calls.reviewer).toBe(2);
    const attempts = verdictAttempts(rehearsal, "code-review");
    expect(attempts.map((attempt) => [attempt.ordinal, attempt.status])).toEqual([[1, "passed"], [2, "passed"]]);
    expect(attempts[0].evidence_fingerprint).not.toBe(attempts[1].evidence_fingerprint);
  });

  it("finishes the exact in-flight attempt from its verified persisted receipt after a crash between persisting and finishing", () => {
    const { rehearsal, session, head } = waitingCandidate();
    const { calls, dependencies } = host(session, head);
    const first = review(rehearsal, "qa", dependencies);
    const [attempt] = verdictAttempts(rehearsal, "qa");
    expect(attempt).toMatchObject({ status: "passed" });
    // The crash: the judgment and its receipts were persisted, the lineage attempt was never finished.
    withDatabase(rehearsal.workspace, (db) => db.prepare(
      "UPDATE session_role_attempts SET status = 'running', terminal_receipt_json = NULL WHERE request_id = ?").run(attempt.request_id));

    const recovered = review(rehearsal, "qa", dependencies);
    expect(recovered.data).toMatchObject({ reused: true, decision: { id: first.data.decision.id } });
    expect(calls.reviewer).toBe(1);
    expect(verdictAttempts(rehearsal, "qa").map((x) => [x.request_id, x.ordinal, x.status, x.terminal_receipt_json]))
      .toEqual([[attempt.request_id, 1, "passed", attempt.terminal_receipt_json]]);

    // A receipt never finishes an attempt whose binding moved since: that records a stale failure instead.
    withDatabase(rehearsal.workspace, (db) => db.prepare(
      "UPDATE session_role_attempts SET status = 'running', terminal_receipt_json = NULL WHERE request_id = ?").run(attempt.request_id));
    const receiptId = `worker-tick-preserve-${session.id}`;
    withDatabase(rehearsal.workspace, (db) => {
      const row = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?").get(receiptId) as { receipt_json: string };
      db.prepare("UPDATE candidate_preservation_receipts SET receipt_json = ? WHERE request_id = ?")
        .run(JSON.stringify({ ...JSON.parse(row.receipt_json), validationEvidenceRef: "re-validated-evidence.json" }), receiptId);
    });
    expect(review(rehearsal, "qa", dependencies).data.reused).toBe(false);
    expect(verdictAttempts(rehearsal, "qa").map((x) => [x.ordinal, x.status, JSON.parse(x.terminal_receipt_json ?? "{}").stale === true]))
      .toEqual([[1, "failed", true], [2, "passed", false]]);
  });

  it("resumes a reviewer that crashed after its attempt began instead of allocating a second one", () => {
    const { rehearsal, session, head } = waitingCandidate();
    const { dependencies } = host(session, head);
    const crashed = withDatabase(rehearsal.workspace, (db) => beginIndependentVerdict(db, {
      role: "code-review", session, repoRoot: rehearsal.repo, requestId: "code-review-pr-7-crashed-before-finish",
      actorId: `code-review-reviewer:${REVIEWER_BINDING}`, executionCwd: rehearsal.root, reviewerBindingId: REVIEWER_BINDING, now: rehearsal.now
    }).attempt);
    expect(crashed.status).toBe("running");

    expect(review(rehearsal, "code-review", dependencies).data.verdict).toBe("pass");
    expect(verdictAttempts(rehearsal, "code-review").map((attempt) => [attempt.request_id, attempt.ordinal, attempt.status]))
      .toEqual([[crashed.request_id, 1, "passed"]]);
  });
});
