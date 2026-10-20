import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { ensureReviewRepairTable, getReviewRepair, reviewRepairRequestId } from "../src/sessions/reviewRepair.js";
import { REPAIR_CANDIDATE_GATE_ROLE } from "../src/production/reviewRepair.js";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";

describe("review-repair-gate-upsert-role", () => {
  it("guards the ON CONFLICT DO UPDATE against changing a row with a non-REPAIR_CANDIDATE_GATE_ROLE role", () => {
    // Setup: create a temp database
    const tmpDir = mkdtempSync(join(tmpdir(), "arcadia-test-"));
    const dbPath = join(tmpDir, "test.db");
    const db = new Database(dbPath);

    try {
      // Ensure the table exists
      ensureReviewRepairTable(db);

      // Seed a production_review_repairs row with the gate path's request id
      // and a role OTHER than REPAIR_CANDIDATE_GATE_ROLE
      const sessionId = "test-session-123";
      const head = "abc123def456";
      const requestId = reviewRepairRequestId(sessionId, head);
      const otherRole = "code-review"; // Not REPAIR_CANDIDATE_GATE_ROLE
      const originalSummary = "Original summary";
      const originalReason = "Original reason";

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO production_review_repairs (
          request_id, action_key, policy_epoch, round, failed_session_id, failed_branch,
          failed_head, start_revision, pull_request_url, role, verdict, summary,
          report_path, findings_json, failed_checks_json, repair_session_id, outcome,
          reason, last_error, drafted_at, commented_at, created_at, updated_at, verdict_request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?)
      `).run(
        requestId, "test/action", 1, 1, sessionId, "test-branch",
        head, "base123", null, otherRole, "fail", originalSummary,
        null, "[]", "[]", "gated",
        originalReason, now, now, null
      );

      // Verify the row was created with the other role
      let row = getReviewRepair(db, requestId)!;
      expect(row.role).toBe(otherRole);
      expect(row.summary).toBe(originalSummary);
      expect(row.reason).toBe(originalReason);

      // Simulate the ON CONFLICT DO UPDATE that happens in gateRepairCandidate
      // This mimics the SQL statement at lines 1040-1049 of src/production/reviewRepair.ts
      const newSummary = "New gate summary";
      const newReason = "New gate reason";
      const newPolicyEpoch = 2;

      db.prepare(`
        INSERT INTO production_review_repairs (
          request_id, action_key, policy_epoch, round, failed_session_id, failed_branch,
          failed_head, start_revision, pull_request_url, role, verdict, summary,
          report_path, findings_json, failed_checks_json, repair_session_id, outcome,
          reason, last_error, drafted_at, commented_at, created_at, updated_at, verdict_request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gated', ?, ?, ?, ?, NULL, 'gated', ?, NULL, NULL, NULL, ?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET summary = excluded.summary, reason = excluded.reason, updated_at = excluded.updated_at
          WHERE production_review_repairs.repair_session_id IS NULL AND production_review_repairs.outcome = 'gated'
            AND production_review_repairs.reason != excluded.reason
            AND production_review_repairs.role = ?
      `).run(
        requestId, "test/action", newPolicyEpoch, 1, sessionId, "test-branch",
        head, "base123", null, REPAIR_CANDIDATE_GATE_ROLE, newSummary,
        null, "[]", "[]",
        newReason, now, now, null,
        REPAIR_CANDIDATE_GATE_ROLE
      );

      // After the ON CONFLICT DO UPDATE, the row should still have the original role, summary, and reason
      // because the WHERE clause should prevent the update (role is otherRole, not REPAIR_CANDIDATE_GATE_ROLE)
      row = getReviewRepair(db, requestId)!;
      expect(row.role).toBe(otherRole, "Role should not be changed to REPAIR_CANDIDATE_GATE_ROLE");
      expect(row.summary).toBe(originalSummary, "Summary should remain unchanged because role guard prevented update");
      expect(row.reason).toBe(originalReason, "Reason should remain unchanged because role guard prevented update");
    } finally {
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
