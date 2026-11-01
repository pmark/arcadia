import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
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
import { Rehearsal } from "./helpers/rehearsalHarness.js";
import { schedulingFixture } from "./schedulingFixture.js";

/**
 * Issue #1929: a review repair escalation binds only the Action input its
 * stopped candidate was developed for. It stops holding the Action once the
 * Action's input differs from that candidate's, and never on a production
 * epoch change alone; the escalation row and its repair record stay exactly
 * as recorded. Hermetic: temporary workspaces and Git fixtures, fake
 * provider and GitHub, no live worker.
 */

const roots: string[] = [];
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const STOPPED_SESSION = "session_stopped_candidate";

/** The escalated Action and where its Plan lives. */
interface Target { repo: string; projectSlug: string; planSlug: string; actionId: string }
const keyOf = (target: Target) => `${target.projectSlug}/${target.actionId}`;

function fixture(): Target & { workspace: string } {
  // `a` is the escalated Action; `e` is independent of it.
  const created = schedulingFixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "e" }] }]);
  roots.push(created.root);
  return { workspace: created.workspace, repo: created.repos.alpha, projectSlug: "alpha", planSlug: "alpha-plan", actionId: "a" };
}

function grant(db: Database.Database, requestId: string): number {
  const scope = normalizeProductionScope({
    intent: "Run the scoped Actions.", projects: ["alpha"], plans: ["alpha/alpha-plan"], actions: ["alpha/a", "alpha/e"],
    providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: ["pointer"]
  });
  activateProduction(db, { requestId, scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" });
  return readProductionPolicy(db).epoch;
}

function actionOf(target: Target): PlanActionDoc {
  const plan = discoverDocs(target.repo).docs.find((doc) => doc.type === "plan" && doc.project === target.projectSlug && doc.slug === target.planSlug);
  if (plan?.type !== "plan") throw new Error("fixture Plan missing");
  return plan.actions.find((action) => action.id === target.actionId)!;
}

const currentInput = (target: Target) =>
  requirementIdentity({ projectSlug: target.projectSlug, planSlug: target.planSlug, action: actionOf(target) }).inputRevision;

const KIND = { escalated: "review_repair_rounds_exhausted", gated: "review_repair_gated" } as const;

/** The escalation the review repair loop leaves when it stops, and the repair row it was recorded from. */
function recordRepairStop(db: Database.Database, target: Target, epoch: number, outcome: "escalated" | "gated" = "escalated"): void {
  ensureReviewRepairTable(db);
  db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
      start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, reason,
      last_error, drafted_at, commented_at, created_at, updated_at, verdict_request_id)
    VALUES (?, ?, ?, 3, ?, 'claude/stopped', 'f412f5fd2357', 'start', 'https://github.com/example/repo/pull/1783', 'code-review', 'needs-follow-up',
      'still failed', NULL, '[]', '[]', NULL, ?, 'The repair loop stopped.', NULL, NULL, NULL, '2026-10-26T05:55:00.000Z', '2026-10-26T05:55:00.000Z', NULL)`)
    .run(`worker-tick-repair-${STOPPED_SESSION}-f412f5fd2357`, keyOf(target), epoch, STOPPED_SESSION, outcome);
  db.prepare(`INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
    VALUES (?, ?, 'repair escalated', 'operator', '2026-10-26T05:55:00.000Z', '2026-10-26T05:55:00.000Z')`)
    .run(keyOf(target), KIND[outcome]);
}

/** The stopped candidate's preserved, passed development attempt under `inputRevision`. */
function recordStoppedCandidateLineage(db: Database.Database, target: Target, inputRevision: string): void {
  ensureCandidatePreservationTable(db);
  db.prepare(`INSERT INTO candidate_preservation_receipts (
      id, request_id, repository_path, candidate_worktree_path, branch, base_branch, base_revision,
      action_id, packet_sha256, policy_epoch, policy_revision, candidate_fingerprint, commit_sha,
      preservation_state, pushed_remote, pull_request_number, pull_request_url, retry_action, receipt_json, created_at
    ) VALUES ('cp_stopped', ?, ?, ?, 'claude/stopped', 'main', 'base', ?, 'sha', 1, 1, 'fp', 'f412f5fd2357',
      'IN PR', 'origin', 1783, 'https://github.com/example/repo/pull/1783', NULL, '{}', '2026-10-26T05:45:00.000Z')`)
    .run(`worker-tick-preserve-${STOPPED_SESSION}`, target.repo, target.repo, target.actionId);
  const requirement = requirementIdentity({ projectSlug: target.projectSlug, planSlug: target.planSlug, action: actionOf(target) });
  db.prepare(`INSERT INTO session_role_attempts (id, requirement_id, input_revision, role, ordinal, request_id, actor_id, mutation_owner, status,
      target_head, criteria_fingerprint, evidence_fingerprint, terminal_receipt_json, created_at, updated_at)
    VALUES ('attempt_stopped', ?, ?, 'development', 1, 'dev-stopped', 'worker', 0, 'passed', NULL, NULL, NULL, ?, '2026-10-26T05:00:00.000Z', '2026-10-26T05:45:00.000Z')`)
    .run(requirement.requirementId, inputRevision, JSON.stringify({ sessionId: STOPPED_SESSION }));
}

const repairRows = (db: Database.Database) => db.prepare("SELECT * FROM production_review_repairs").all();
const snapshot = (db: Database.Database) => ({ escalations: db.prepare("SELECT * FROM production_operator_escalations").all(), repairs: repairRows(db) });
const nextOf = (db: Database.Database) => buildProjectSchedule(db, getProjectBySlug(db, "alpha")!).next;

describe("a review repair escalation and the Action input it binds (Issue #1929)", () => {
  it("still holds the Action in the same production epoch for the same Action input", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      recordRepairStop(db, fx, grant(db, "grant-1"));
      recordStoppedCandidateLineage(db, fx, currentInput(fx));

      expect(operatorHeldEscalation(db, "alpha/a", { repoRoot: fx.repo, planSlug: "alpha-plan" })).toMatchObject({ kind: KIND.escalated });
      expect(reviewRepairEscalationState(db, "alpha/a", { repoRoot: fx.repo, planSlug: "alpha-plan" })?.staleReason).toBeNull();
      // Passed over for the independent Action, exactly as before.
      expect(nextOf(db)).toBe("alpha/e");
      expect(runSchedulingPass(db, { now: new Date("2026-11-01T12:00:00.000Z") }).projects[0]?.pointer).toMatchObject({ moved: true, from: "a", to: "e" });
    });
  });

  it("still holds the Action after an epoch change alone (same input), keeping the escalation and repair record", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const stoppedEpoch = grant(db, "grant-46");
      recordRepairStop(db, fx, stoppedEpoch);
      recordStoppedCandidateLineage(db, fx, currentInput(fx));
      deactivateProduction(db, { requestId: "off-46" });
      expect(grant(db, "grant-47")).toBeGreaterThan(stoppedEpoch);
      const before = snapshot(db);

      expect(operatorHeldEscalation(db, "alpha/a", { repoRoot: fx.repo, planSlug: "alpha-plan" })).toMatchObject({ kind: KIND.escalated });
      expect(nextOf(db)).toBe("alpha/e");
      expect(snapshot(db)).toEqual(before);
    });
  });

  it("stops holding the Action once its input (criteria or packet) differs from the stopped candidate's, keeping both records", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      recordRepairStop(db, fx, grant(db, "grant-1"));
      // The stopped candidate was developed for an earlier input of the Action (re-scoped since, as in #1937).
      recordStoppedCandidateLineage(db, fx, "input-before-rescope");
      const before = snapshot(db);

      expect(operatorHeldEscalation(db, "alpha/a", { repoRoot: fx.repo, planSlug: "alpha-plan" })).toBeNull();
      expect(reviewRepairEscalationState(db, "alpha/a", { action: actionOf(fx), planSlug: "alpha-plan" })?.staleReason)
        .toContain("developed for a superseded input");
      // The scheduler reads the Action from the Plan it already discovered.
      expect(nextOf(db)).toBe("alpha/a");
      expect(runSchedulingPass(db, { now: new Date("2026-11-01T12:00:00.000Z") }).projects[0]?.pointer.moved).toBe(false);
      expect(snapshot(db)).toEqual(before);
    });
  });

  it("releases a gated stop too once the input changed (the new candidate is judged afresh), but never on an epoch change alone", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      const stoppedEpoch = grant(db, "grant-46");
      recordRepairStop(db, fx, stoppedEpoch, "gated");
      recordStoppedCandidateLineage(db, fx, currentInput(fx));
      deactivateProduction(db, { requestId: "off-46" });
      grant(db, "grant-47");
      expect(operatorHeldEscalation(db, "alpha/a", { repoRoot: fx.repo, planSlug: "alpha-plan" })).toMatchObject({ kind: KIND.gated });
      db.prepare("UPDATE session_role_attempts SET input_revision = 'input-before-rescope' WHERE id = 'attempt_stopped'").run();
      expect(operatorHeldEscalation(db, "alpha/a", { repoRoot: fx.repo, planSlug: "alpha-plan" })).toBeNull();
    });
  });

  it("fails closed when the stop's candidate input cannot be judged", () => {
    const fx = fixture();
    withDatabase(fx.workspace, (db) => {
      recordRepairStop(db, fx, grant(db, "grant-1"));
      // No preservation receipt or lineage for the stopped candidate.
      expect(operatorHeldEscalation(db, "alpha/a", { repoRoot: fx.repo, planSlug: "alpha-plan" })).not.toBeNull();
      expect(nextOf(db)).toBe("alpha/e");
    });
  });
});

describe("the worker tick and a review repair escalation (Issue #1929)", () => {
  function rehearsalWithStop(input: "current" | "superseded", epochChange: boolean) {
    const rehearsal = new Rehearsal({ independentReviewers: false });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate("stop-grant-46");
    const target: Target = { repo: rehearsal.repo, projectSlug: rehearsal.projectSlug, planSlug: rehearsal.planSlug, actionId: rehearsal.actionA.split("/")[1] };
    withDatabase(rehearsal.workspace, (db) => {
      recordRepairStop(db, target, readProductionPolicy(db).epoch);
      recordStoppedCandidateLineage(db, target, input === "current" ? currentInput(target) : "input-before-rescope");
    });
    if (epochChange) {
      rehearsal.deactivate("stop-off-46");
      rehearsal.activate("stop-grant-47");
    }
    return rehearsal;
  }
  const escalationKinds = (rehearsal: Rehearsal) => withReadOnlyDatabase(rehearsal.workspace, (db) =>
    db.prepare("SELECT action_key, kind FROM production_operator_escalations ORDER BY action_key").all());

  it("leaves the escalation's kind unchanged and never relaunches the Action after an epoch change alone", () => {
    const rehearsal = rehearsalWithStop("current", true);
    const before = withReadOnlyDatabase(rehearsal.workspace, repairRows);
    const tick = rehearsal.tick();
    expect(tick.launch?.actionKey ?? null).not.toBe(rehearsal.actionA);
    expect(escalationKinds(rehearsal)).toContainEqual({ action_key: rehearsal.actionA, kind: KIND.escalated });
    expect(withReadOnlyDatabase(rehearsal.workspace, repairRows)).toEqual(before);
  });

  it("admits a fresh attempt of the Action through attemptProjectLaunch once its input is superseded", () => {
    const rehearsal = rehearsalWithStop("superseded", true);
    const before = withReadOnlyDatabase(rehearsal.workspace, repairRows);
    const launched = rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3).at(-1)!;
    expect(launched.launch).toMatchObject({ outcome: "launched", actionKey: rehearsal.actionA });
    expect(rehearsal.log.filter((line) => line.includes("no longer holds it: its stopped candidate was developed for a superseded input"))).toHaveLength(1);
    // The repair record is kept unchanged; the launch path clears the current-escalation row as it always has.
    expect(withReadOnlyDatabase(rehearsal.workspace, repairRows)).toEqual(before);
  });
});
