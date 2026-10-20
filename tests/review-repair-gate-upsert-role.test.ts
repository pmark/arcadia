import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { gateRepairCandidate, REPAIR_CANDIDATE_GATE_ROLE } from "../src/production/reviewRepair.js";
import type { AgentSession } from "../src/sessions/index.js";
import { ensureReviewRepairTable, reviewRepairRequestId, type ReviewRepairRow } from "../src/sessions/reviewRepair.js";
import { git } from "./helpers/rehearsalHarness.js";

/**
 * The repair-candidate gate upserts its row by request id. A row another path
 * wrote under that id (a different role) must never be rewritten by the gate;
 * an eligible gate-role row still is, including one whose reason is NULL.
 */
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SESSION_ID = "repair-session-1";

/** A real repository whose candidate changes a gated path (src/sessions/), so the gate path fires. */
function gatedFixture(): { repoRoot: string; head: string; base: string; db: Database.Database; session: AgentSession } {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "gate-upsert-role-"));
  roots.push(repoRoot);
  const run = (args: string[]) => git(repoRoot, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args]);
  run(["init", "-q", "-b", "main"]);
  writeFileSync(path.join(repoRoot, "README.md"), "base\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "base"]);
  const base = run(["rev-parse", "HEAD"]).trim();
  mkdirSync(path.join(repoRoot, "src/sessions"), { recursive: true });
  writeFileSync(path.join(repoRoot, "src/sessions/launch.ts"), "export const x = 1;\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "repair"]);
  // The gate judges the repair's change up to its settlement commit's parent.
  writeFileSync(path.join(repoRoot, "README.md"), "settled\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "settlement"]);
  const head = run(["rev-parse", "HEAD"]).trim();
  const db = new Database(":memory:");
  ensureReviewRepairTable(db);
  const session = { id: SESSION_ID, branch: "repair-branch", project_slug: "proj", action_id: "act", base_revision: base } as unknown as AgentSession;
  return { repoRoot, head, base, db, session };
}

function insertRow(db: Database.Database, values: { requestId: string; role: string; summary: string; reason: string | null; repairSessionId: string | null; round?: number; base: string; head: string }): void {
  db.prepare(`INSERT INTO production_review_repairs (request_id, action_key, policy_epoch, round, failed_session_id, failed_branch, failed_head,
      start_revision, pull_request_url, role, verdict, summary, report_path, findings_json, failed_checks_json, repair_session_id, outcome, reason,
      created_at, updated_at)
    VALUES (?, 'proj/act', 1, ?, ?, 'repair-branch', ?, ?, NULL, ?, 'gated', ?, NULL, '[]', '[]', ?, 'gated', ?, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z')`)
    .run(values.requestId, values.round ?? 1, SESSION_ID, values.head, values.base, values.role, values.summary, values.repairSessionId, values.reason);
}

function runGate(f: ReturnType<typeof gatedFixture>): string | null {
  return gateRepairCandidate(f.db, {
    repoRoot: f.repoRoot, session: f.session, head: f.head, now: new Date("2026-10-20T12:00:00.000Z"), escalate: () => {}
  });
}

const rowOf = (db: Database.Database, requestId: string) =>
  db.prepare("SELECT * FROM production_review_repairs WHERE request_id = ?").get(requestId) as ReviewRepairRow;

describe("gateRepairCandidate upsert role guard", () => {
  it("leaves a conflicting row written under another role unchanged", () => {
    const f = gatedFixture();
    // The repair's own row, found through repair_session_id.
    insertRow(f.db, { requestId: "worker-tick-repair-original", role: "code-review", summary: "orig", reason: "orig", repairSessionId: SESSION_ID, base: f.base, head: f.head });
    const requestId = reviewRepairRequestId(SESSION_ID, f.head);
    insertRow(f.db, { requestId, role: "code-review", summary: "Original summary", reason: "Original reason", repairSessionId: null, base: f.base, head: f.head });

    const reason = runGate(f);

    expect(reason).toContain("Decision 0098's gate list");
    const row = rowOf(f.db, requestId);
    expect(row.role).toBe("code-review");
    expect(row.summary).toBe("Original summary");
    expect(row.reason).toBe("Original reason");
  });

  it("still updates an eligible gate-role row, including one with a NULL reason", () => {
    const f = gatedFixture();
    insertRow(f.db, { requestId: "worker-tick-repair-original", role: "code-review", summary: "orig", reason: "orig", repairSessionId: SESSION_ID, base: f.base, head: f.head });
    const requestId = reviewRepairRequestId(SESSION_ID, f.head);
    insertRow(f.db, { requestId, role: REPAIR_CANDIDATE_GATE_ROLE, summary: "stale", reason: null, repairSessionId: null, base: f.base, head: f.head });

    const reason = runGate(f);

    const row = rowOf(f.db, requestId);
    expect(row.role).toBe(REPAIR_CANDIDATE_GATE_ROLE);
    expect(row.reason).toBe(reason);
    expect(row.summary).not.toBe("stale");
    expect(row.updated_at).toBe("2026-10-20T12:00:00.000Z");
  });
});
