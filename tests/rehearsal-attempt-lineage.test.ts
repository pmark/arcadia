import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { getSession, type AgentSession } from "../src/sessions/index.js";
import {
  beginDevelopmentAttempt,
  beginIndependentVerdict,
  finishIndependentVerdict,
  independentVerdictGate,
  requirementIdentity
} from "../src/sessions/roleLineage.js";
import { applyInitialSchema } from "../src/db/schema.js";
import { git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * The fixed five-role lineage through the real worker tick (see the harness
 * for exactly what is simulated). Independent reviewers are off here so each
 * test drives them explicitly.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];

function activated() {
  const rehearsal = new Rehearsal({ independentReviewers: false });
  rehearsals.push(rehearsal);
  rehearsal.createFixtureRepository();
  rehearsal.approve(rehearsal.registerProject());
  rehearsal.activate();
  return rehearsal;
}

function launchA(rehearsal: Rehearsal): AgentSession {
  rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
  return rehearsal.lease()!;
}

/** A finishes and exits; the exit tick preserves and accepts it but waits for verdicts. */
function exitedA(rehearsal: Rehearsal): AgentSession {
  const a = launchA(rehearsal);
  rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
  rehearsal.agentFinish(a, CRITERIA_A);
  rehearsal.tmux.exit(a.tmux_session_name);
  const exited = rehearsal.tick();
  expect(exited.reconciled[0]?.outcome).toBe("accepted_completion");
  expect(exited.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/current independent verdicts/) });
  return withDatabase(rehearsal.workspace, (db) => getSession(db, a.id)!);
}

function gate(rehearsal: Rehearsal, session: AgentSession) {
  return withDatabase(rehearsal.workspace, (db) => independentVerdictGate(db, { session, repoRoot: rehearsal.repo }));
}

function verdict(rehearsal: Rehearsal, session: AgentSession, role: "code-review" | "qa", input: { requestId?: string; actorId?: string; executionCwd?: string; retryAuthorized?: boolean } = {}) {
  const requestId = input.requestId ?? `${role}-explicit-${Math.random().toString(36).slice(2, 10)}`;
  const actorId = input.actorId ?? `${role}-reviewer:independent`;
  return withDatabase(rehearsal.workspace, (db) => {
    beginIndependentVerdict(db, {
      role, session, repoRoot: rehearsal.repo, requestId, actorId, executionCwd: input.executionCwd ?? rehearsal.root,
      retryAuthorized: input.retryAuthorized, now: rehearsal.now
    });
    return finishIndependentVerdict(db, { requestId, actorId, session, repoRoot: rehearsal.repo, verdict: "passed", receipt: { role }, now: rehearsal.now });
  });
}

const code = (fn: () => unknown) => {
  try { fn(); } catch (error) { return (error as { details?: { code?: string } }).details?.code ?? String(error); }
  return null;
};

describe("five-role attempt lineage through the real tick", () => {
  it("refuses a reviewer before deterministic readiness and refuses every developer identity, allocating nothing", () => {
    const rehearsal = activated();
    const a = launchA(rehearsal);
    // Still running and unpreserved: no reviewer may start, and no attempt row appears.
    expect(code(() => verdict(rehearsal, a, "qa"))).toBe("verdict_not_ready");
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    rehearsal.tick();
    const session = withDatabase(rehearsal.workspace, (db) => getSession(db, a.id)!);
    const development = rehearsal.attempts("write-marker-a").find((x) => x.role === "development")!;
    expect(development).toMatchObject({ status: "passed", mutation_owner: 1 });

    // The developer can never supply its own review or QA: not under its
    // attempt identity, its Session or admission ids, nor from its worktree.
    for (const identity of [
      { actorId: development.actor_id },
      { actorId: session.id },
      { actorId: session.admission_request_id! },
      { executionCwd: session.worktree_path },
      { executionCwd: path.join(session.worktree_path, "docs") }
    ]) {
      expect(code(() => verdict(rehearsal, session, "code-review", identity))).toBe("independent_actor_required");
    }
    expect(rehearsal.attempts("write-marker-a").filter((x) => x.role === "code-review" || x.role === "qa")).toEqual([]);
    expect(gate(rehearsal, session)).toMatchObject({ satisfied: false, reason: expect.stringMatching(/code-review: none; qa: none/) });

    // One verdict alone never integrates.
    verdict(rehearsal, session, "code-review");
    expect(gate(rehearsal, session)).toMatchObject({ satisfied: false, reason: expect.stringMatching(/qa: none/) });
    expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-a")).toBe("open");

    verdict(rehearsal, session, "qa");
    const integrated = rehearsal.tick();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-a")).toBe("done");
  });

  it("invalidates dependent verdicts when the candidate head, the governed criteria, or the validation evidence changes", () => {
    const rehearsal = activated();
    const session = exitedA(rehearsal);
    verdict(rehearsal, session, "code-review");
    verdict(rehearsal, session, "qa");
    expect(gate(rehearsal, session).satisfied).toBe(true);

    // Evidence: a re-validation that produced different evidence.
    const receiptId = `worker-tick-preserve-${session.id}`;
    const original = withDatabase(rehearsal.workspace, (db) =>
      (db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?").get(receiptId) as { receipt_json: string }).receipt_json);
    const setEvidence = (json: string) => withDatabase(rehearsal.workspace, (db) =>
      db.prepare("UPDATE candidate_preservation_receipts SET receipt_json = ? WHERE request_id = ?").run(json, receiptId));
    setEvidence(JSON.stringify({ ...JSON.parse(original), validationEvidenceRef: "re-validated-evidence.json" }));
    expect(gate(rehearsal, session)).toMatchObject({ satisfied: false, reason: expect.stringMatching(/code-review: stale; qa: stale/) });
    expect(rehearsal.tick().handoff?.integration.kind).toBe("refused");
    setEvidence(original);
    expect(gate(rehearsal, session).satisfied).toBe(true);

    // Re-judging a binding that already passed is refused: it is neither a superseded binding nor a retry after failure.
    expect(code(() => verdict(rehearsal, session, "qa", { actorId: "qa-reviewer:second" }))).toBe("attempt_retry_not_authorized");

    // A reviewer that starts on new evidence and sees it move again before finishing records a stale failure, never a pass.
    setEvidence(JSON.stringify({ ...JSON.parse(original), validationEvidenceRef: "re-validated-evidence.json" }));
    const requestId = "qa-reviewer-racing-evidence-change";
    withDatabase(rehearsal.workspace, (db) => beginIndependentVerdict(db, {
      role: "qa", session, repoRoot: rehearsal.repo, requestId, actorId: "qa-reviewer:second", executionCwd: rehearsal.root, now: rehearsal.now
    }));
    setEvidence(JSON.stringify({ ...JSON.parse(original), validationEvidenceRef: "moved-mid-review.json" }));
    const raced = withDatabase(rehearsal.workspace, (db) => finishIndependentVerdict(db, {
      requestId, actorId: "qa-reviewer:second", session, repoRoot: rehearsal.repo, verdict: "passed", receipt: {}, now: rehearsal.now
    }));
    expect(raced).toMatchObject({ stale: true, attempt: { status: "failed" } });
    setEvidence(original);
    // The latest QA attempt is now that stale failure, so the gate waits for a fresh QA verdict on the current binding.
    expect(gate(rehearsal, session)).toMatchObject({ satisfied: false, reason: expect.stringMatching(/qa: failed/) });
    verdict(rehearsal, session, "qa");
    expect(rehearsal.attempts("write-marker-a").filter((x) => x.role === "qa").map((x) => [x.ordinal, x.status]))
      .toEqual([[1, "passed"], [2, "failed"], [3, "passed"]]);
    expect(gate(rehearsal, session).satisfied).toBe(true);

    // Criteria: amending the governed acceptance criteria on the base changes the requirement input.
    const planFile = path.join(rehearsal.repo, "docs", "plans", "two-action-rehearsal-bootstrap.md");
    const plan = git(rehearsal.repo, ["show", "HEAD:docs/plans/two-action-rehearsal-bootstrap.md"]);
    writeFileSync(planFile, plan.replace(`followed by a trailing newline, with no other content.`, `followed by a trailing newline, and nothing else at all.`));
    git(rehearsal.repo, ["-c", "user.name=Operator", "-c", "user.email=operator@rehearsal.test", "commit", "-qam", "amend A's criteria"]);
    expect(gate(rehearsal, session)).toMatchObject({ satisfied: false, reason: expect.stringMatching(/No passed development attempt exists for the current governed Action input/) });
    git(rehearsal.repo, ["-c", "user.name=Operator", "-c", "user.email=operator@rehearsal.test", "revert", "--no-edit", "HEAD"]);
    expect(gate(rehearsal, session).satisfied).toBe(true);

    // Push: a new commit on the candidate after its verdicts.
    writeFileSync(path.join(session.worktree_path, "LATE.md"), "pushed after review\n");
    git(session.worktree_path, ["add", "LATE.md"]);
    git(session.worktree_path, ["-c", "user.name=Agent", "-c", "user.email=agent@rehearsal.test", "commit", "-qm", "late push"]);
    expect(gate(rehearsal, session)).toMatchObject({ satisfied: false, reason: expect.stringMatching(/head changed after its development attempt finished/) });
    const refused = rehearsal.tick();
    expect(refused.handoff?.integration.kind).toBe("refused");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-a")).toBe("open");
  });

  it("resumes a crashed launch's own attempt, keeps one attempt across a resumable split, and allocates a bounded next ordinal only after terminal failure", () => {
    const rehearsal = activated();
    // A launch that crashed after allocating its development attempt but
    // before any Session row existed (no admission, worktree or claim).
    const crashed = withDatabase(rehearsal.workspace, (db) => {
      const plan = discoverDocs(rehearsal.repo).docs.find((doc) => doc.type === "plan");
      const action = plan?.type === "plan" ? plan.actions.find((entry) => entry.id === "write-marker-a")! : null;
      return beginDevelopmentAttempt(db, {
        requirement: requirementIdentity({ projectSlug: rehearsal.projectSlug, planSlug: rehearsal.planSlug, action: action! }),
        requestId: "worker-tick-crashed-before-session", retryAuthorized: true, now: rehearsal.now
      }).attempt;
    });
    expect(crashed.status).toBe("pending");

    // Restart: the next ticks (fresh connections) resume that same attempt.
    const a1 = launchA(rehearsal);
    expect(rehearsal.attempts("write-marker-a").map((x) => [x.request_id, x.ordinal, x.status])).toEqual([[crashed.request_id, 1, "running"]]);

    // A resumable exit keeps the attempt live; the resumed Session continues it.
    rehearsal.agentEdit(a1, "MARKER.md", `${LINE_A}\n`);
    rehearsal.tmux.exit(a1.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("incomplete_resumable");
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 2);
    const a2 = rehearsal.lease()!;
    expect(a2.id).not.toBe(a1.id);
    expect(rehearsal.attempts("write-marker-a").map((x) => [x.request_id, x.ordinal, x.status])).toEqual([[crashed.request_id, 1, "running"]]);
    rehearsal.agentFinish(a2, CRITERIA_A);
    rehearsal.tmux.exit(a2.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    expect(rehearsal.attempts("write-marker-a").map((x) => [x.request_id, x.ordinal, x.status])).toEqual([[crashed.request_id, 1, "passed"]]);
  });

  it("allocates exactly one bounded next development ordinal after a terminal failure, and replays the exit without re-settling", () => {
    const rehearsal = activated();
    const a1 = launchA(rehearsal);
    // A1 dies before changing anything: a terminal failure, not a resumable exit.
    rehearsal.tmux.exit(a1.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toMatch(/missing_evidence|failed_execution/);
    expect(rehearsal.attempts("write-marker-a").map((x) => [x.ordinal, x.status])).toEqual([[1, "failed"]]);
    const failedAt = rehearsal.attempts("write-marker-a")[0].updated_at;

    // The launch grant authorizes exactly the next bounded ordinal, once, across later ticks.
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3);
    const later = [rehearsal.tick(), rehearsal.tick()];
    expect(later.every((r) => r.launch?.outcome !== "launched")).toBe(true);
    const lineage = rehearsal.attempts("write-marker-a");
    expect(lineage.map((x) => [x.ordinal, x.status])).toEqual([[1, "failed"], [2, "running"]]);
    expect(lineage[0].updated_at).toBe(failedAt);
    expect(lineage[1].request_id).not.toBe(lineage[0].request_id);
  });

  it("never admits a second mutation owner when two connections begin the same requirement", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-lineage-race-")));
    const file = path.join(root, "arcadia.db");
    const first = new Database(file);
    const second = new Database(file);
    try {
      applyInitialSchema(first);
      const action = {
        id: "write-marker-a", nextAction: "Write the marker.", acceptanceCriteria: ["The marker exists."], responsibility: "agent",
        resolvedExecution: null, execution: null
      } as unknown as Parameters<typeof requirementIdentity>[0]["action"];
      const requirement = requirementIdentity({ projectSlug: "p", planSlug: "plan", action });
      const now = new Date("2026-10-03T19:00:00.000Z");
      const a = beginDevelopmentAttempt(first, { requirement, requestId: "launch-one", retryAuthorized: true, now });
      const b = beginDevelopmentAttempt(second, { requirement, requestId: "launch-two", retryAuthorized: true, now });
      expect(a.resumed).toBe(false);
      expect(b).toMatchObject({ resumed: true, attempt: { id: a.attempt.id } });
      // A revised input supersedes (fails) the live owner before allocating its own; still exactly one live owner.
      const revised = requirementIdentity({ projectSlug: "p", planSlug: "plan", action: { ...action, acceptanceCriteria: ["The marker exists twice."] } });
      const c = beginDevelopmentAttempt(second, { requirement: revised, requestId: "launch-three", retryAuthorized: true, now });
      expect(c.resumed).toBe(false);
      const live = first.prepare("SELECT request_id, status FROM session_role_attempts WHERE requirement_id = ? ORDER BY created_at, rowid").all(requirement.requirementId);
      expect(live).toEqual([{ request_id: a.attempt.request_id, status: "failed" }, { request_id: c.attempt.request_id, status: "pending" }]);
    } finally {
      first.close();
      second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
