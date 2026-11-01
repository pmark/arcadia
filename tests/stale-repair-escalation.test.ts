import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { withDatabase } from "../src/db/connection.js";
import { getProjectBySlug } from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import type { PlanActionDoc } from "../src/docs/types.js";
import {
  activateProduction,
  deactivateProduction,
  fingerprintProductionScope,
  normalizeProductionScope,
  readProductionPolicy
} from "../src/production/policy.js";
import { operatorHeldEscalation, reviewRepairEscalationState } from "../src/production/terminalCandidates.js";
import { buildProjectSchedule } from "../src/scheduling/schedule.js";
import { runSchedulingPass } from "../src/scheduling/scheduler.js";
import { ensureCandidatePreservationTable } from "../src/sessions/candidatePreservation.js";
import { ensureReviewRepairTable } from "../src/sessions/reviewRepair.js";
import { requirementIdentity } from "../src/sessions/roleLineage.js";
import { schedulingFixture } from "./schedulingFixture.js";

/**
 * Issue #1929: a review repair escalation binds only the candidate it was
 * recorded for. It stops holding the Action once the Action's input or the
 * production epoch differs from the stopped candidate's, while the
 * escalation row and its repair record stay exactly as recorded.
 * Hermetic: a temporary workspace and Git fixture, no worker, no GitHub.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ACTION_KEY = "alpha/a";
const STOPPED_SESSION = "session_stopped_candidate";

function fixture() {
  // `a` is the escalated Action; `e` is independent of it.
  const created = schedulingFixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "e" }] }]);
  roots.push(created.root);
  return created;
}

function grant(db: Database.Database, requestId: string): number {
  const scope = normalizeProductionScope({
    intent: "Run the scoped Actions.", projects: ["alpha"], plans: ["alpha/alpha-plan"], actions: ["alpha/a", "alpha/e"],
    providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: ["pointer"]
  });
  activateProduction(db, { requestId, scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" });
  return readProductionPolicy(db).epoch;
}

function actionA(repo: string): PlanActionDoc {
  const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "alpha-plan");
  if (plan?.type !== "plan") throw new Error("fixture Plan missing");
  return plan.actions.find((action) => action.id === "a")!;
}

/** The escalation the review repair loop leaves when its rounds are spent, and the repair row it was recorded from. */
function recordRoundsExhausted(db: Database.Database, epoch: number, outcome: "escalated" | "gated" = "escalated"): void {
  ensureReviewRepairTable(db);
  db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
      start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, reason,
      last_error, drafted_at, commented_at, created_at, updated_at, verdict_request_id)
    VALUES (?, ?, ?, 3, ?, 'claude/a', 'f412f5fd2357', 'start', 'https://github.com/example/repo/pull/1783', 'code-review', 'needs-follow-up',
      'still failed', NULL, '[]', '[]', NULL, ?, 'The 3 repair rounds are spent.', NULL, NULL, NULL, '2026-10-26T05:55:00.000Z', '2026-10-26T05:55:00.000Z', NULL)`)
    .run(`worker-tick-repair-${STOPPED_SESSION}-f412f5fd2357`, ACTION_KEY, epoch, STOPPED_SESSION, outcome);
  db.prepare(`INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
    VALUES (?, ?, 'repair escalated', 'operator', '2026-10-26T05:55:00.000Z', '2026-10-26T05:55:00.000Z')`)
    .run(ACTION_KEY, outcome === "escalated" ? "review_repair_rounds_exhausted" : "review_repair_gated");
}

/** The stopped candidate's preserved, passed development attempt under `inputRevision`. */
function recordStoppedCandidateLineage(db: Database.Database, repo: string, inputRevision: string): void {
  ensureCandidatePreservationTable(db);
  db.prepare(`INSERT INTO candidate_preservation_receipts (
      id, request_id, repository_path, candidate_worktree_path, branch, base_branch, base_revision,
      action_id, packet_sha256, policy_epoch, policy_revision, candidate_fingerprint, commit_sha,
      preservation_state, pushed_remote, pull_request_number, pull_request_url, retry_action, receipt_json, created_at
    ) VALUES ('cp_stopped', ?, ?, ?, 'claude/a', 'main', 'base', 'a', 'sha', 1, 1, 'fp', 'f412f5fd2357',
      'IN PR', 'origin', 1783, 'https://github.com/example/repo/pull/1783', NULL, '{}', '2026-10-26T05:45:00.000Z')`)
    .run(`worker-tick-preserve-${STOPPED_SESSION}`, repo, repo);
  const requirement = requirementIdentity({ projectSlug: "alpha", planSlug: "alpha-plan", action: actionA(repo) });
  db.prepare(`INSERT INTO session_role_attempts (id, requirement_id, input_revision, role, ordinal, request_id, actor_id, mutation_owner, status,
      target_head, criteria_fingerprint, evidence_fingerprint, terminal_receipt_json, created_at, updated_at)
    VALUES ('attempt_stopped', ?, ?, 'development', 1, 'dev-stopped', 'worker', 1, 'passed', NULL, NULL, NULL, ?, '2026-10-26T05:00:00.000Z', '2026-10-26T05:45:00.000Z')`)
    .run(requirement.requirementId, inputRevision, JSON.stringify({ sessionId: STOPPED_SESSION }));
}

const snapshot = (db: Database.Database) => ({
  escalations: db.prepare("SELECT * FROM production_operator_escalations").all(),
  repairs: db.prepare("SELECT * FROM production_review_repairs").all()
});
const nextOf = (db: Database.Database) => buildProjectSchedule(db, getProjectBySlug(db, "alpha")!).next;

describe("a review repair escalation that no longer binds its Action (Issue #1929)", () => {
  it("still holds the Action in the same production epoch for the same Action input", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const epoch = grant(db, "grant-1");
      recordRoundsExhausted(db, epoch);
      const current = requirementIdentity({ projectSlug: "alpha", planSlug: "alpha-plan", action: actionA(fx.repos.alpha) });
      recordStoppedCandidateLineage(db, fx.repos.alpha, current.inputRevision);

      expect(operatorHeldEscalation(db, ACTION_KEY, { repoRoot: fx.repos.alpha, planSlug: "alpha-plan" })).toMatchObject({ kind: "review_repair_rounds_exhausted" });
      expect(reviewRepairEscalationState(db, ACTION_KEY, { repoRoot: fx.repos.alpha })?.staleReason).toBeNull();
      // Passed over for the independent Action, exactly as before.
      expect(nextOf(db)).toBe("alpha/e");
      expect(runSchedulingPass(db, { now: new Date("2026-11-01T12:00:00.000Z") }).projects[0]?.pointer).toMatchObject({ moved: true, from: "a", to: "e" });
    });
  });

  it("stops holding the Action once production runs a later epoch, keeping the escalation and repair record", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const stoppedEpoch = grant(db, "grant-46");
      recordRoundsExhausted(db, stoppedEpoch);
      const current = requirementIdentity({ projectSlug: "alpha", planSlug: "alpha-plan", action: actionA(fx.repos.alpha) });
      recordStoppedCandidateLineage(db, fx.repos.alpha, current.inputRevision);
      expect(operatorHeldEscalation(db, ACTION_KEY)).not.toBeNull();

      deactivateProduction(db, { requestId: "off-46" });
      const epoch = grant(db, "grant-47");
      expect(epoch).toBeGreaterThan(stoppedEpoch);
      const before = snapshot(db);

      expect(operatorHeldEscalation(db, ACTION_KEY)).toBeNull();
      expect(reviewRepairEscalationState(db, ACTION_KEY)?.staleReason).toContain(`spent in production epoch ${stoppedEpoch}, and production now runs epoch ${epoch}`);
      expect(nextOf(db)).toBe("alpha/a");
      expect(runSchedulingPass(db, { now: new Date("2026-11-01T12:00:00.000Z") }).projects[0]?.pointer.moved).toBe(false);
      // Kept for history: nothing reset or rewritten.
      expect(snapshot(db)).toEqual(before);
    });
  });

  it("keeps a gated stop binding across an epoch change", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const stoppedEpoch = grant(db, "grant-46");
      recordRoundsExhausted(db, stoppedEpoch, "gated");
      deactivateProduction(db, { requestId: "off-46" });
      grant(db, "grant-47");
      expect(operatorHeldEscalation(db, ACTION_KEY)).toMatchObject({ kind: "review_repair_gated" });
      expect(nextOf(db)).toBe("alpha/e");
    });
  });

  it("stops holding the Action once its input (criteria or packet) differs from the stopped candidate's, in the same epoch", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const epoch = grant(db, "grant-1");
      recordRoundsExhausted(db, epoch);
      // The stopped candidate was developed for an earlier input of the Action (re-scoped since, as in #1937).
      recordStoppedCandidateLineage(db, fx.repos.alpha, "input-before-rescope");
      const before = snapshot(db);

      expect(operatorHeldEscalation(db, ACTION_KEY, { repoRoot: fx.repos.alpha, planSlug: "alpha-plan" })).toBeNull();
      expect(reviewRepairEscalationState(db, ACTION_KEY, { action: actionA(fx.repos.alpha), planSlug: "alpha-plan" })?.staleReason)
        .toContain("developed for a superseded input");
      // The scheduler reads the Action from the Plan it already discovered.
      expect(nextOf(db)).toBe("alpha/a");
      expect(runSchedulingPass(db, { now: new Date("2026-11-01T12:00:00.000Z") }).projects[0]?.pointer.moved).toBe(false);
      expect(snapshot(db)).toEqual(before);
    });
  });

  it("fails closed when the stop's candidate input cannot be judged", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const epoch = grant(db, "grant-1");
      recordRoundsExhausted(db, epoch);
      // No preservation receipt or lineage for the stopped candidate, and no Action supplied.
      expect(operatorHeldEscalation(db, ACTION_KEY)).not.toBeNull();
      expect(nextOf(db)).toBe("alpha/e");
    });
  });
});
