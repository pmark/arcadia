import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { ensureProductionTickTables, launchSkipReason, recordTerminalCandidateEscalation } from "../src/production/tick.js";
import { candidateLandingCommand } from "../src/production/sessionHandoff.js";
import { releaseMergedReviewRepairs } from "../src/production/reviewRepair.js";
import { ensureReviewRepairTable } from "../src/sessions/reviewRepair.js";
import type { AgentSession } from "../src/sessions/index.js";

/** Issue #1632: a terminal-guard refusal must not stay masked by a stale repair stop. */
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const run = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
function repo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "refusal-masking-"));
  roots.push(root);
  run(root, ["init", "-q", "-b", "main"]);
  const commit = (name: string) => { writeFileSync(path.join(root, name), name); run(root, ["add", "."]); run(root, ["commit", "-qm", name]); };
  commit("a");
  run(root, ["checkout", "-q", "-b", "cand"]);
  commit("c");
  run(root, ["checkout", "-q", "main"]);
  commit("b"); // base advances past the candidate's merge base
  return root;
}
const NOW = new Date("2026-10-21T00:00:00Z");
const session = { id: "s1", project_slug: "p", action_id: "a1", branch: "cand", worktree_path: "/nonexistent/worktree" } as unknown as AgentSession;
function db(): BetterSqlite3.Database {
  const d = new BetterSqlite3(":memory:");
  ensureProductionTickTables(d);
  ensureReviewRepairTable(d);
  d.exec("CREATE TABLE IF NOT EXISTS production_operator_escalations (action_key TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, remedy TEXT, first_detected_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)");
  return d;
}
function repairRow(d: BetterSqlite3.Database, branch: string, head: string, outcome = "gated"): void {
  d.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head, start_revision,
    role, verdict, summary, findings_json, failed_checks_json, outcome, created_at, updated_at) VALUES ('r1','p/a1',1,1,'s1',?,?,'x','code-review','fail','s','[]','[]',?,?,?)`)
    .run(branch, head, outcome, NOW.toISOString(), NOW.toISOString());
}

describe("defect 1: the real refusal supersedes a stale repair stop on another head", () => {
  const facts = { session, reason: "The terminal candidate differs from its exact canonical completion settlement.", head: "newhead", settlementCommit: null, operatorMergeCommand: "m" };
  it("replaces review_repair_gated recorded for an older head", () => {
    const d = db();
    repairRow(d, "cand", "oldhead");
    d.prepare("INSERT INTO production_operator_escalations VALUES ('p/a1','review_repair_gated','old stop','qa code-review --rerun',?,?)").run(NOW.toISOString(), NOW.toISOString());
    expect(recordTerminalCandidateEscalation(d, { facts, repoRoot: "/nonexistent", now: NOW, log: () => {} })).toBe(true);
    const row = d.prepare("SELECT kind, message FROM production_operator_escalations WHERE action_key = 'p/a1'").get() as { kind: string; message: string };
    expect(row.kind).toBe("terminal_candidate_not_integrable");
    expect(row.message).toContain("differs from its exact canonical completion settlement");
  });
  it("keeps a repair stop that names the same head", () => {
    const d = db();
    repairRow(d, "cand", "newhead");
    d.prepare("INSERT INTO production_operator_escalations VALUES ('p/a1','review_repair_gated','old stop','r',?,?)").run(NOW.toISOString(), NOW.toISOString());
    expect(recordTerminalCandidateEscalation(d, { facts, repoRoot: "/nonexistent", now: NOW, log: () => {} })).toBe(false);
  });
});

describe("defect 2: the remedy matches the base state", () => {
  it("offers a GitHub merge pinned to the head when base advanced past the candidate", () => {
    const root = repo();
    const head = run(root, ["rev-parse", "cand"]);
    const cmd = candidateLandingCommand({ repoRoot: root, branch: "cand", baseBranch: "main", head, pullRequestUrl: "https://github.com/o/r/pull/7" });
    expect(cmd).toBe(`gh pr merge https://github.com/o/r/pull/7 --merge --match-head-commit ${head}`);
  });
  it("keeps ff-only when it would succeed", () => {
    const root = repo();
    run(root, ["checkout", "-q", "cand"]); run(root, ["merge", "-q", "--no-edit", "main"]);
    const cmd = candidateLandingCommand({ repoRoot: root, branch: "cand", baseBranch: "main", head: run(root, ["rev-parse", "cand"]), pullRequestUrl: "https://github.com/o/r/pull/7" });
    expect(cmd).toContain("merge --ff-only cand");
  });
});

describe("defect 3: the launch skip names the truthful reason", () => {
  it("does not claim a reconciliation when nothing was reconciled", () => {
    const reason = launchSkipReason({ reconciledCount: 0, refusal: { reason: "Worker merge refused (review_missing): x", operatorMergeCommand: "gh pr merge 7" }, sessionId: "s1" });
    expect(reason).not.toContain("just reconciled");
    expect(reason).toContain("s1");
    expect(reason).toContain("gh pr merge 7");
  });
  it("keeps the reconciliation wording when a Session was reconciled", () => {
    expect(launchSkipReason({ reconciledCount: 1, refusal: null, sessionId: null })).toContain("just reconciled");
  });
});

describe("defect 4: a merged candidate closes its gated repair row", () => {
  it("releases a gated row whose branch is on the base, and only that", () => {
    const root = repo();
    const d = db();
    repairRow(d, "cand", "oldhead");
    expect(releaseMergedReviewRepairs(d, { repoRoot: root, baseBranch: "main", now: NOW })).toBe(0); // cand is not on main yet
    run(root, ["merge", "-q", "--no-ff", "-m", "m", "cand"]);
    expect(releaseMergedReviewRepairs(d, { repoRoot: root, baseBranch: "main", now: NOW })).toBe(1);
    expect((d.prepare("SELECT outcome FROM production_review_repairs").get() as { outcome: string }).outcome).toBe("released");
  });
});
