import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { currentActionOf, gitIntegration, journeyContext } from "../src/commands/journey.js";
import { classifyObstacle } from "../src/journey/classify.js";
import { deriveJourney, firstLine } from "../src/journey/derive.js";
import { applyInitialSchema } from "../src/db/schema.js";
import { ensureRedAlertTables } from "../src/production/redAlerts.js";
import { ensureProductionPolicyTables } from "../src/production/policy.js";
import { ensureProductionReviewStepTable } from "../src/production/independentReview.js";
import { ensureProductionTickTables } from "../src/production/tick.js";
import { ensureWorkerMergeTable } from "../src/production/workerMerge.js";
import { ensureCandidatePreservationTable } from "../src/sessions/candidatePreservation.js";
import { ensureReviewRepairTable } from "../src/sessions/reviewRepair.js";

/**
 * The journey of one Action, derived from a fixture database shaped like the
 * real arcadia/implement-docs-reports-first-supervised-claude path on
 * 2026-10-19: PR #1545, a failed review, a repair to #1554, another failed
 * review, a capacity refusal, a repair to #1577, now under review.
 */

const PROJECT = "arcadia";
const PLAN = "demo-plan";
const ACTION = "demo-action";
const KEY = `${PROJECT}/${ACTION}`;
const REQUIREMENT = `${PROJECT}/${PLAN}/${ACTION}`;
const NOW = new Date("2026-10-19T16:00:00.000Z");
const HEAD = { a: "a".repeat(40), b: "b".repeat(40), c: "c".repeat(40) };
const pr = (n: number) => `https://github.com/pmark/arcadia/pull/${n}`;

let db: Database.Database;
let counter = 0;

/** Inserts a row, filling NOT NULL columns the test does not care about with unique placeholders. */
function insert(table: string, values: Record<string, unknown>): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown; type: string; pk: number }>;
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.name in values) row[column.name] = values[column.name];
    else if ((column.notnull || column.pk) && column.dflt_value === null) row[column.name] = /INT/i.test(column.type) ? 0 : `${column.name}-${++counter}`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")})`).run(row);
}

function session(id: string, branch: string, at: string, status = "completed"): void {
  insert("agent_sessions", { id, project_slug: PROJECT, plan_slug: PLAN, action_id: ACTION, work_item_id: "work-1", branch, status, terminal_transport: "tmux", prepared_at: at, started_at: at, ended_at: status === "completed" ? at : null, is_simulated: 0 });
  insert("session_exit_receipts", { session_id: id, outcome: "accepted_completion", reason: "Settled.", created_at: at, next_action_json: "{}" });
}

function attempt(role: string, ordinal: number, status: string, head: string, at: string, verdict = "fail", inputRevision = "rev", extra: Record<string, unknown> = {}): void {
  insert("session_role_attempts", { requirement_id: REQUIREMENT, input_revision: inputRevision, role, ordinal, status, target_head: head, terminal_receipt_json: JSON.stringify({ verdict, ...extra }), created_at: at, updated_at: at, mutation_owner: 0 });
}

function seedPath(): void {
  db.prepare("UPDATE production_policy SET epoch = 2 WHERE id = 'workspace'").run();
  insert("work_items", { id: "work-1", title: "Write the report", raw_input: "x", queue: "work_queue", work_classification: "agent", next_action: "x", status: "done", created_at: NOW.toISOString(), updated_at: NOW.toISOString() });
  insert("production_admissions", { action_key: KEY, project_slug: PROJECT, plan_slug: PLAN, provider: "claude-code-cli", epoch: 1, policy_revision: 1, status: "released", issued_at: "2026-10-18T21:48:00.000Z", expires_at: "2026-10-19T21:48:00.000Z", committed_at: "2026-10-18T21:48:00.000Z" });

  session("s1", "claude/demo-1", "2026-10-18T21:49:00.000Z");
  insert("candidate_preservation_receipts", { action_id: ACTION, branch: "claude/demo-1", commit_sha: HEAD.a, preservation_state: "IN PR", pull_request_number: 1545, pull_request_url: pr(1545), created_at: "2026-10-18T21:50:00.000Z", policy_epoch: 1, policy_revision: 1 });
  attempt("development", 1, "passed", HEAD.a, "2026-10-18T21:49:00.000Z");
  attempt("code-review", 1, "failed", HEAD.a, "2026-10-18T22:01:00.000Z");
  insert("production_review_repairs", { request_id: "repair-1", action_key: KEY, policy_epoch: 1, round: 1, failed_session_id: "s1", failed_branch: "claude/demo-1", failed_head: HEAD.a, pull_request_url: pr(1545), role: "code-review", verdict: "fail", summary: "The report omits #1512.", findings_json: "[]", failed_checks_json: "[]", repair_session_id: "s2", outcome: "launched", created_at: "2026-10-19T02:17:00.000Z", updated_at: "2026-10-19T05:18:00.000Z", closed_at: "2026-10-19T05:18:00.000Z" });

  session("s2", "claude/demo-2", "2026-10-19T05:12:00.000Z");
  insert("candidate_preservation_receipts", { action_id: ACTION, branch: "claude/demo-2", commit_sha: HEAD.b, preservation_state: "IN PR", pull_request_number: 1554, pull_request_url: pr(1554), created_at: "2026-10-19T05:14:00.000Z", policy_epoch: 1, policy_revision: 1 });
  attempt("development", 2, "passed", HEAD.b, "2026-10-19T05:12:00.000Z");
  attempt("code-review", 2, "failed", HEAD.b, "2026-10-19T05:25:00.000Z");
  insert("production_red_alerts", { id: "ra-1", alert_key: "admission_refused_consecutive:arcadia:x", project_slug: PROJECT, action_key: KEY, trigger: "admission_refused_consecutive", detail: "Admission refused: Claude Code's 5h window reset; the stored credential was rejected.", evidence_path: "x.md", status: "cleared", first_seen_at: "2026-10-19T15:11:00.000Z", last_seen_at: "2026-10-19T15:28:00.000Z", cleared_at: "2026-10-19T15:28:00.000Z" });
  insert("production_review_repairs", { request_id: "repair-2", action_key: KEY, policy_epoch: 2, round: 1, failed_session_id: "s2", failed_branch: "claude/demo-2", failed_head: HEAD.b, pull_request_url: pr(1554), role: "code-review", verdict: "fail", summary: "The patch check misread the completion Ask.", findings_json: "[]", failed_checks_json: "[]", repair_session_id: "s3", outcome: "launched", created_at: "2026-10-19T05:25:00.000Z", updated_at: "2026-10-19T15:36:00.000Z", closed_at: "2026-10-19T15:36:00.000Z" });

  session("s3", "claude/demo-3", "2026-10-19T15:29:00.000Z");
  insert("candidate_preservation_receipts", { action_id: ACTION, branch: "claude/demo-3", commit_sha: HEAD.c, preservation_state: "IN PR", pull_request_number: 1577, pull_request_url: pr(1577), created_at: "2026-10-19T15:31:00.000Z", policy_epoch: 2, policy_revision: 1 });
  attempt("development", 3, "passed", HEAD.c, "2026-10-19T15:29:00.000Z");
  insert("production_review_steps", { request_id: "step-3", session_id: "s3", action_key: KEY, target_head: HEAD.c, pull_request_url: pr(1577), policy_epoch: 2, failures: 0, total_failures: 0, last_outcome_json: JSON.stringify({ kind: "waiting", reason: "Waiting for required checks on PR 1577." }), created_at: "2026-10-19T15:36:00.000Z", updated_at: "2026-10-19T15:50:00.000Z" });
  insert("production_operator_escalations", { action_key: KEY, kind: "awaiting_independent_verdicts", message: "Integration waits on current independent verdicts.", first_detected_at: "2026-10-19T15:31:00.000Z", last_seen_at: "2026-10-19T15:50:00.000Z" });
}

beforeEach(() => {
  db = new Database(":memory:");
  applyInitialSchema(db);
  db.pragma("foreign_keys = OFF");
  for (const ensure of [ensureRedAlertTables, ensureProductionPolicyTables, ensureProductionReviewStepTable, ensureProductionTickTables, ensureWorkerMergeTable, ensureCandidatePreservationTable, ensureReviewRepairTable]) ensure(db);
  counter = 0;
});

describe("deriveJourney", () => {
  it("tells the real path: launch, three PR victories, cleared obstacles, now in review", () => {
    seedPath();
    const journey = deriveJourney(db, KEY, NOW);

    expect(journey.schema).toBe("arcadia-journey-v1");
    expect(journey.action).toEqual({ key: KEY, project: PROJECT, plan: PLAN, id: ACTION, title: "Write the report" });
    expect(journey.events.map((event) => `${event.kind}:${event.label}`)).toEqual([
      "launch:launched",
      "victory:#1545",
      "cleared:review fail",
      "victory:#1554",
      "cleared:review fail",
      "cleared:admission refused consecutive",
      "victory:#1577"
    ]);
    expect(journey.events.find((event) => event.label === "#1554")?.detail).toContain("Supersedes #1545");
    expect(journey.events.find((event) => event.source === "production_red_alerts")?.class).toBe("capacity-credential");
    expect(journey.events.every((event) => event.kind !== "obstacle")).toBe(true);

    expect(journey.now).toMatchObject({ kind: "now", label: "#1577 awaiting checks", at: "2026-10-19T15:50:00.000Z", ref: { kind: "pr", id: "1577", url: pr(1577) } });
    expect(journey.gate).toMatchObject({ kind: "gate", label: "independent review" });
    expect(journey.budget).toEqual({ reviewAttempts: { spent: 2, inUse: 0, limit: 5 }, repairRounds: { spent: 1, inUse: 0, limit: 3 } });
    expect(journey.ahead.map((branch) => [branch.id, branch.available])).toEqual([["pass", true], ["repair", true]]);
    expect(journey.destination).toMatchObject({ label: "PR merged", reached: false, ref: { id: "1577" } });
  });

  it("puts an open obstacle on the path and closes the repair branch when no verdict attempt is left", () => {
    seedPath();
    attempt("code-review", 3, "failed", HEAD.c, "2026-10-19T15:55:00.000Z");
    attempt("code-review", 4, "failed", HEAD.c, "2026-10-19T15:56:00.000Z");
    attempt("code-review", 5, "failed", HEAD.c, "2026-10-19T15:57:00.000Z");
    insert("production_review_repairs", { request_id: "repair-3", action_key: KEY, policy_epoch: 2, round: 2, failed_session_id: "s3", failed_branch: "claude/demo-3", failed_head: HEAD.c, pull_request_url: pr(1577), role: "code-review", verdict: "fail", summary: "Misattributed fix.", findings_json: "[]", failed_checks_json: "[]", outcome: "escalated", reason: "No independent code-review attempt remains.\nFindings (report …): 1. credential handling", created_at: "2026-10-19T15:57:00.000Z", updated_at: "2026-10-19T15:57:00.000Z" });
    db.prepare("UPDATE production_operator_escalations SET kind = 'review_repair_rounds_exhausted', message = 'No attempt remains. Findings (report): credential handling'").run();

    const journey = deriveJourney(db, KEY, NOW);
    const open = journey.events.filter((event) => event.kind === "obstacle");
    expect(open.map((event) => event.label)).toEqual(["review fail", "review fail", "review fail", "repair escalated"]);
    // The escalation duplicates the repair row; it is not told twice, and its quoted report never classifies.
    expect(open.find((event) => event.label === "repair escalated")).toMatchObject({ detail: "No independent code-review attempt remains.", class: null });
    expect(journey.budget.reviewAttempts).toEqual({ spent: 5, inUse: 0, limit: 5 });
    expect(journey.ahead.find((branch) => branch.id === "repair")?.available).toBe(false);
    expect(journey.ahead.find((branch) => branch.id === "pass")?.label).toMatch(/operator/);
  });

  it("reaches the destination on a worker merge and drops now, gate and the way ahead", () => {
    seedPath();
    insert("production_worker_merges", { request_id: "merge-1", session_id: "s3", action_key: KEY, pull_request_url: pr(1577), head: HEAD.c, outcome: "merged", reason: "Merged.", boundaries_json: "[]", updated_at: "2026-10-19T15:59:00.000Z" });
    const journey = deriveJourney(db, KEY, NOW);
    expect(journey.destination).toMatchObject({ reached: true, at: "2026-10-19T15:59:00.000Z", ref: { id: "1577" } });
    expect(journey.now).toBeNull();
    expect(journey.gate).toBeNull();
    expect(journey.ahead).toEqual([]);
  });

  it("budgets verdict attempts per input revision and labels a stale verdict", () => {
    seedPath();
    attempt("code-review", 1, "failed", HEAD.a, "2026-10-17T10:00:00.000Z", "fail", "older-rev");
    attempt("code-review", 3, "failed", HEAD.c, "2026-10-19T15:55:00.000Z", "passed", "rev", { stale: true });
    const journey = deriveJourney(db, KEY, NOW);
    expect(journey.budget.reviewAttempts).toEqual({ spent: 3, inUse: 0, limit: 5 });
    expect(journey.events.at(-1)).toMatchObject({ kind: "obstacle", label: "review stale" });
  });

  it("counts repair rounds in the current production epoch only", () => {
    seedPath();
    db.prepare("UPDATE production_policy SET epoch = 3 WHERE id = 'workspace'").run();
    expect(deriveJourney(db, KEY, NOW).budget.repairRounds.spent).toBe(0);
  });

  it("reaches the destination when the head is already in the base branch, and clears what it met on the way", () => {
    seedPath();
    insert("production_review_repairs", { request_id: "repair-3", action_key: KEY, policy_epoch: 2, round: 2, failed_session_id: "s3", failed_branch: "claude/demo-3", failed_head: HEAD.c, pull_request_url: pr(1577), role: "code-review", verdict: "fail", summary: "x", findings_json: "[]", failed_checks_json: "[]", outcome: "escalated", reason: "No attempt remains.", created_at: "2026-10-19T15:57:00.000Z", updated_at: "2026-10-19T15:57:00.000Z" });
    const asked: unknown[] = [];
    const journey = deriveJourney(db, KEY, NOW, { integration: (input) => { asked.push(input); return { commit: "m".repeat(40), at: "2026-10-19T15:58:00.000Z" }; } });
    expect(asked).toEqual([{ repositoryPath: expect.any(String), head: HEAD.c, baseBranch: expect.any(String) }]);
    expect(journey.destination).toMatchObject({ reached: true, at: "2026-10-19T15:58:00.000Z", ref: { id: "1577" } });
    expect(journey.events.filter((event) => event.kind === "obstacle")).toEqual([]);
    expect(journey.events.find((event) => event.label === "repair escalated")?.kind).toBe("cleared");
    expect(journey.now).toBeNull();
    expect(journey.ahead).toEqual([]);
  });

  it("stays on the way when the head is not in the base branch, and warns when Git cannot answer", () => {
    seedPath();
    expect(deriveJourney(db, KEY, NOW, { integration: () => null }).destination.reached).toBe(false);
    const failed = deriveJourney(db, KEY, NOW, { integration: () => { throw new Error("not a git repository"); } });
    expect(failed.destination.reached).toBe(false);
    expect(failed.warnings).toEqual([expect.stringContaining("not a git repository")]);
  });

  it("never counts a head equal to the Session's base revision as an arrival", () => {
    seedPath();
    db.prepare("UPDATE agent_sessions SET base_revision = ? WHERE id = 's3'").run(HEAD.c);
    let asked = false;
    expect(deriveJourney(db, KEY, NOW, { integration: () => { asked = true; return { commit: HEAD.c, at: "2026-10-01T00:00:00.000Z" }; } }).destination.reached).toBe(false);
    expect(asked).toBe(false);
  });

  describe("activity", () => {
    const activity = () => deriveJourney(db, KEY, NOW).activity;

    it("is in review while the PR waits for checks, and stopped on an open obstacle", () => {
      seedPath();
      expect(activity()).toMatchObject({ phase: "in-review", headline: "In review: PR #1577 awaiting checks", since: "2026-10-19T15:50:00.000Z" });
      attempt("code-review", 3, "failed", HEAD.c, "2026-10-19T15:55:00.000Z");
      expect(activity()).toMatchObject({ phase: "blocked", headline: "Stopped: review fail", since: "2026-10-19T15:55:00.000Z" });
    });

    it("is under repair while a repair Session runs, and queued while its repair is pending in the running production", () => {
      seedPath();
      db.prepare("UPDATE production_policy SET desired_state = 'active' WHERE id = 'workspace'").run();
      insert("production_review_repairs", { request_id: "repair-q", action_key: KEY, policy_epoch: 2, round: 2, failed_session_id: "s3", failed_branch: "claude/demo-3", failed_head: HEAD.c, role: "code-review", verdict: "fail", summary: "Fix it.", findings_json: "[]", failed_checks_json: "[]", outcome: "pending", created_at: "2026-10-19T15:56:00.000Z", updated_at: "2026-10-19T15:56:00.000Z" });
      expect(activity()).toMatchObject({ phase: "repairing", headline: "Repair round queued" });
      // A newer run, or production Off: the old pending row is no longer queued.
      db.prepare("UPDATE production_policy SET epoch = 3 WHERE id = 'workspace'").run();
      expect(activity().phase).not.toBe("repairing");
      db.prepare("UPDATE production_policy SET epoch = 2, desired_state = 'inactive' WHERE id = 'workspace'").run();
      expect(activity().phase).not.toBe("repairing");
      db.prepare("UPDATE production_policy SET desired_state = 'active' WHERE id = 'workspace'").run();
      db.prepare("UPDATE production_review_repairs SET outcome = 'launched', repair_session_id = 's4' WHERE request_id = 'repair-q'").run();
      session("s4", "claude/demo-4", "2026-10-19T15:57:00.000Z", "running");
      expect(activity()).toMatchObject({ phase: "repairing", headline: "Under repair: round 2 of 3", since: "2026-10-19T15:57:00.000Z" });
    });

    it("drives while an ordinary Session runs", () => {
      session("s1", "claude/demo-1", "2026-10-19T15:00:00.000Z", "running");
      expect(activity()).toMatchObject({ phase: "driving", headline: "Driving: a Session is working" });
    });

    it("explains why an Action has not launched: production Off, out of scope, refused, waiting, or admitted", () => {
      expect(activity()).toMatchObject({ phase: "parked", headline: "Parked: production is Off" });
      db.prepare("UPDATE production_policy SET desired_state = 'active', scope_json = ?, updated_at = ? WHERE id = 'workspace'").run(JSON.stringify({ actions: ["arcadia/other"] }), "2026-10-19T15:00:00.000Z");
      expect(activity()).toMatchObject({ phase: "parked", headline: "Parked: not in this production run" });
      db.prepare("UPDATE production_policy SET scope_json = ? WHERE id = 'workspace'").run(JSON.stringify({ actions: [KEY] }));
      expect(activity()).toMatchObject({ phase: "waiting", headline: "Waiting to launch" });
      insert("production_launch_refusal_log", { action_key: KEY, dedupe_key: "d", message: "Launch refused: capacity window closed.\nmore", first_at: "2026-10-19T15:10:00.000Z", last_at: "2026-10-19T15:20:00.000Z" });
      expect(activity()).toMatchObject({ phase: "blocked", headline: "Stopped: launch refused", detail: "Launch refused: capacity window closed." });
      // Turning production Off after a refusal does not clear it; activating a new run after it does.
      db.prepare("UPDATE production_policy SET desired_state = 'inactive', updated_at = ? WHERE id = 'workspace'").run("2026-10-19T15:25:00.000Z");
      expect(deriveJourney(db, KEY, NOW).events.find((event) => event.source === "production_launch_refusal_log")?.kind).toBe("obstacle");
      db.prepare("UPDATE production_policy SET desired_state = 'active' WHERE id = 'workspace'").run();
      db.prepare("UPDATE production_policy SET updated_at = ? WHERE id = 'workspace'").run("2026-10-19T15:25:00.000Z");
      expect(activity()).toMatchObject({ phase: "waiting", headline: "Waiting to launch" });
      db.prepare("UPDATE production_policy SET epoch = 2 WHERE id = 'workspace'").run();
      insert("production_admissions", { action_key: KEY, project_slug: PROJECT, plan_slug: PLAN, provider: "claude-code-cli", epoch: 2, policy_revision: 2, status: "issued", issued_at: "2026-10-19T15:30:00.000Z", expires_at: "2026-10-19T16:30:00.000Z" });
      expect(activity()).toMatchObject({ phase: "launching", since: "2026-10-19T15:30:00.000Z" });
      // An expired admission, or one from an earlier run, is not a launch under way.
      db.prepare("UPDATE production_admissions SET expires_at = '2026-10-19T15:45:00.000Z' WHERE action_key = ?").run(KEY);
      expect(activity()).toMatchObject({ phase: "waiting" });
      db.prepare("UPDATE production_admissions SET expires_at = '2026-10-19T16:30:00.000Z', epoch = 1 WHERE action_key = ?").run(KEY);
      expect(activity()).toMatchObject({ phase: "waiting" });
    });

    it("names the operator's move from the escalation's remedy, unless the worker needs no one, and the run position", () => {
      seedPath();
      expect(deriveJourney(db, KEY, NOW).activity.yourMove).toBeNull();
      db.prepare("UPDATE production_operator_escalations SET kind = 'review_repair_gated', remedy = 'Rerun the review with --rerun.\nmore' WHERE action_key = ?").run(KEY);
      expect(deriveJourney(db, KEY, NOW).activity.yourMove).toBe("Rerun the review with --rerun.");
      db.prepare("UPDATE production_operator_escalations SET remedy = 'No operator step is needed: the worker retries.' WHERE action_key = ?").run(KEY);
      expect(deriveJourney(db, KEY, NOW).activity.yourMove).toBeNull();
      db.prepare("UPDATE production_operator_escalations SET remedy = 'Rate limited: the tick resumes on its own after the reset.' WHERE action_key = ?").run(KEY);
      expect(deriveJourney(db, KEY, NOW).activity.yourMove).toBeNull();
      expect(deriveJourney(db, KEY, NOW).run).toBeNull();
      db.prepare("UPDATE production_policy SET desired_state = 'active', scope_json = ? WHERE id = 'workspace'").run(JSON.stringify({ actions: ["arcadia/first", KEY, "arcadia/last"] }));
      expect(deriveJourney(db, KEY, NOW).run).toEqual({ position: 2, total: 3, next: "arcadia/last" });
    });

    it("has arrived once merged", () => {
      seedPath();
      expect(deriveJourney(db, KEY, NOW, { integration: () => ({ commit: "m".repeat(40), at: "2026-10-19T15:58:00.000Z" }) }).activity)
        .toMatchObject({ phase: "arrived", headline: "Arrived: PR #1577 merged", since: "2026-10-19T15:58:00.000Z" });
    });
  });

  it("returns an empty journey for an Action that never launched", () => {
    const journey = deriveJourney(db, KEY, NOW);
    expect(journey.events).toEqual([]);
    expect(journey.now).toMatchObject({ label: "not launched", at: NOW.toISOString() });
    expect(journey.warnings).toEqual([`No Session has run for ${KEY} yet.`]);
  });

  it("refuses a malformed action key", () => {
    expect(() => deriveJourney(db, "no-slash", NOW)).toThrow(/<project>\/<action>/);
  });

  it("never writes to the database", () => {
    seedPath();
    const before = db.prepare("SELECT total_changes() AS n").get() as { n: number };
    deriveJourney(db, KEY, NOW);
    expect((db.prepare("SELECT total_changes() AS n").get() as { n: number }).n).toBe(before.n);
  });
});

describe("classifyObstacle", () => {
  it.each([
    ["Claude credential 401", "capacity-credential"],
    ["Stale verdict under old checker", "stale-judgement"],
    ["Merge gate misread a draft", "gate-misreads-bookkeeping"],
    ["Patch check misjudged midnight", "gate-misreads-bookkeeping"],
    ["tmux could not start the Codex Session", "environment-wall"],
    ["commit author identity missing", "identity-attestation"],
    ["Packet approval expired", "timing"],
    ["The report omits #1512", null]
  ])("%s → %s", (text, expected) => {
    expect(classifyObstacle(text)).toBe(expected);
  });

  it("keeps only the headline of a message that quotes a report", () => {
    expect(firstLine("A fail; no attempt remains. Findings (report x):\n1. y")).toBe("A fail; no attempt remains.");
  });
});

describe("gitIntegration", () => {
  it("finds the base-branch merge commit that landed a head, and nothing for an unmerged head", () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), "journey-git-"));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
    const git = (args: string[], date = "2026-10-19T10:00:00Z") => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "maintenance.auto=false", ...args], { cwd: repo, encoding: "utf8", env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).trim();
    try {
      git(["init", "-q", "-b", "main"]);
      writeFileSync(path.join(repo, "a"), "a"); git(["add", "a"]); git(["commit", "-qm", "base"]);
      git(["checkout", "-qb", "candidate"]);
      writeFileSync(path.join(repo, "b"), "b"); git(["add", "b"]); git(["commit", "-qm", "work"], "2026-10-19T11:00:00Z");
      const head = git(["rev-parse", "HEAD"]);
      git(["checkout", "-qb", "other", "main"]);
      writeFileSync(path.join(repo, "c"), "c"); git(["add", "c"]); git(["commit", "-qm", "unmerged"]);
      const unmerged = git(["rev-parse", "HEAD"]);
      git(["checkout", "-q", "main"]);
      git(["merge", "-q", "--no-ff", "-m", "Merge candidate", "candidate"], "2026-10-19T12:00:00Z");
      const landing = git(["rev-parse", "HEAD"]);
      writeFileSync(path.join(repo, "d"), "d"); git(["add", "d"]); git(["commit", "-qm", "later"], "2026-10-19T13:00:00Z");
      // A squash merge lands the change but never the head itself.
      git(["checkout", "-qb", "squashed", "main"]);
      writeFileSync(path.join(repo, "e"), "e"); git(["add", "e"]); git(["commit", "-qm", "squash me"]);
      const squashedHead = git(["rev-parse", "HEAD"]);
      git(["checkout", "-q", "main"]);
      git(["merge", "-q", "--squash", "squashed"]); git(["commit", "-qm", "Squashed"], "2026-10-19T14:00:00Z");
      // A fast-forward lands the head as itself.
      git(["checkout", "-qb", "ff", "main"]);
      writeFileSync(path.join(repo, "f"), "f"); git(["add", "f"]); git(["commit", "-qm", "ff"], "2026-10-19T15:00:00Z");
      const ffHead = git(["rev-parse", "HEAD"]);
      git(["checkout", "-q", "main"]); git(["merge", "-q", "--ff-only", "ff"]);

      expect(gitIntegration({ repositoryPath: repo, head, baseBranch: "main" })).toEqual({ commit: landing, at: "2026-10-19T12:00:00.000Z" });
      expect(gitIntegration({ repositoryPath: repo, head: unmerged, baseBranch: "main" })).toBeNull();
      expect(gitIntegration({ repositoryPath: repo, head: squashedHead, baseBranch: "main" })).toBeNull();
      expect(gitIntegration({ repositoryPath: repo, head: ffHead, baseBranch: "main" })).toEqual({ commit: ffHead, at: "2026-10-19T15:00:00.000Z" });
      expect(() => gitIntegration({ repositoryPath: path.join(repo, "missing"), head, baseBranch: "main" })).toThrow(/merge-base/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("journeyContext", () => {
  const planAction = (id: string, status: string, why: string | null = null) => ({ id, title: `Do ${id}`, status, why, milestone: null }) as never;
  const documents = {
    slug: "demo",
    project: { slug: "demo", name: "Demo", goal: "Ship it.", outcome: "Shipped.", milestone: "M1", activePlan: "p2" } as never,
    plans: [
      { slug: "p1", milestone: "M0", actions: [planAction("a", "done")] } as never,
      { slug: "p2", milestone: null, actions: [planAction("x", "done"), planAction("y", "done"), planAction("z", "open", "Because.")] } as never
    ]
  };

  it("places the Action in the Plan it ran under, else the active one, with the Project's goal and milestone", () => {
    expect(journeyContext(documents, null, "z")).toEqual({
      project: { name: "Demo", goal: "Ship it.", outcome: "Shipped.", milestone: "M1" },
      plan: { slug: "p2", milestone: "M1", active: true, position: 3, total: 3, done: 2 },
      action: { title: "Do z", why: "Because.", status: "open" }
    });
    expect(journeyContext(documents, "p1", "a").plan).toEqual({ slug: "p1", milestone: "M0", active: false, position: 1, total: 1, done: 1 });
    // No Session yet: the Plan that holds the Action, not the active one.
    expect(journeyContext(documents, null, "a")).toMatchObject({ plan: { slug: "p1", position: 1 }, action: { title: "Do a" } });
  });

  it("finds the Plan that holds the Action when no Plan is known, and says nothing of an unknown Action", () => {
    expect(journeyContext({ ...documents, project: null }, null, "a").plan?.slug).toBe("p1");
    expect(journeyContext(documents, null, "nope")).toMatchObject({ plan: { slug: "p2", position: null }, action: null });
  });
});

describe("currentActionOf", () => {
  const projectDoc = (pointer: string | null) => `---\narcadia: v1\ntype: project\nslug: demo\nname: Demo\nstatus: active\ngoal: Demo goal\nupdated: 2026-10-19\nactive_plan: demo-plan\n${pointer ? `current_action: ${pointer}\n` : ""}---\n\n# Demo\n`;
  const planDoc = (pointer: string) => `---\narcadia: v1\ntype: plan\nslug: demo-plan\nproject: demo\nstatus: active\nactions:\n  - id: a1\n    title: First\n    status: done\n  - id: a2\n    title: Second\n    status: open\ncurrent_action: ${pointer}\n---\n\n# Demo plan\n`;

  it("follows the Project's pointer, and refuses a Project with no pointer or no record", () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), "journey-current-"));
    try {
      mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
      writeFileSync(path.join(repo, "docs", "plans", "demo-plan.md"), planDoc("a1"));
      writeFileSync(path.join(repo, "PROJECT.md"), projectDoc("a2"));
      insert("projects", { id: "project-demo", slug: "demo", name: "Demo", mission: "m", status: "active", created_at: NOW.toISOString(), updated_at: NOW.toISOString() });
      insert("project_metadata", { project_id: "project-demo", repo_path: repo, created_at: NOW.toISOString(), updated_at: NOW.toISOString() });

      expect(currentActionOf(db, "demo")).toBe("a2");
      // The fixture Plan is not a valid managed Plan, so there is no fallback pointer either.
      writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(null));
      expect(() => currentActionOf(db, "demo")).toThrow(/has no current Action/);
      expect(() => currentActionOf(db, "nosuch")).toThrow(/No Project "nosuch"/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
