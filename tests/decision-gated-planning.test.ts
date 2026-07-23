import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { runWorkRunCommand } from "../src/commands/work.js";
import { recoverOrphanedRuns, reduceExecutionOutcome } from "../src/commands/worker.js";
import { withDatabase } from "../src/db/connection.js";
import {
  countRows,
  createProjectWithInitialWork,
  getReviewItem,
  getExecutionRun,
  listReviewItems,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { applyMigrations } from "../src/db/schema.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Decision-gated planning", () => {
  it("canonical ask creates one linked planning Decision with clean wording", () => {
    const workspace = fixtureWorkspace();
    const response = runAskCommand({ workspace, request: "Prepare a plan for adding Pinterest publishing to Rebuster." });
    expect(response.data.intake.proposedAction).toBe("Pinterest publishing for Rebuster.");
    expect(response.data.resolvedIntent.expectedArtifact).toContain("Pinterest publishing plan for Rebuster");
    expect(response.data.reviewItemId).toBeTruthy();
    const decision = withDatabase(workspace, (db) => getReviewItem(db, response.data.reviewItemId!));
    expect(decision).toMatchObject({
      resolved_intent: "CodexPlanningRunApproval",
      work_item_id: response.data.workItem?.id,
      plan_id: response.data.plan?.id,
      project_id: response.data.workItem?.project_id,
      codex_invocation_id: response.data.codexInvocations[0]?.id
    });
    expect(decision?.artifact_id).toBeTruthy();
    expect(JSON.parse(decision!.context_json).packetSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("duplicate planning approval returns the existing Run", () => {
    const workspace = fixtureWorkspace();
    const response = runAskCommand({ workspace, request: "Prepare a plan for adding Pinterest publishing to Rebuster." });
    const first = runReviewApproveCommand({ workspace, id: response.data.reviewItemId! });
    const second = runReviewApproveCommand({ workspace, id: response.data.reviewItemId! });
    expect(second.data.run?.id).toBe(first.data.run?.id);
    expect(withDatabase(workspace, (db) => countRows(db, "execution_runs"))).toBe(1);
  });

  it("modified packet and public work run cannot bypass approval", () => {
    const workspace = fixtureWorkspace();
    const response = runAskCommand({ workspace, request: "Prepare a plan for adding Pinterest publishing to Rebuster." });
    const invocation = response.data.codexInvocations[0]!;
    writeFileSync(path.join(workspace, invocation.prompt_path), `${readFileSync(path.join(workspace, invocation.prompt_path), "utf8")}\nchanged\n`);
    expect(() => runReviewApproveCommand({ workspace, id: response.data.reviewItemId! })).toThrow(/missing or changed/);
    expect(() => runWorkRunCommand({
      workspace,
      workId: response.data.workItem!.id,
      plan: response.data.plan!.id,
      allowCodexPlanning: true
    })).toThrow(/requires an approved Decision/);
    expect(withDatabase(workspace, (db) => countRows(db, "execution_runs"))).toBe(0);
    expect(withDatabase(workspace, (db) => listReviewItems(db, "open"))).toHaveLength(1);
  });

  it("truthful outcome reducer never completes failed execution or Validation", () => {
    expect(reduceExecutionOutcome({ exitStatus: 0, validation: [] })).toBe("completed");
    expect(reduceExecutionOutcome({ exitStatus: 0, validation: [{ exitStatus: 1 }] })).toBe("requires_review");
    expect(reduceExecutionOutcome({ exitStatus: 9, validation: [] })).toBe("failed");
    expect(reduceExecutionOutcome({ exitStatus: null, validation: [] })).toBe("failed");
  });

  it("migration deduplicates Decision and Run-Artifact links without deleting evidence", () => {
    const workspace = fixtureWorkspace();
    const response = runAskCommand({ workspace, request: "Prepare a plan for adding Pinterest publishing to Rebuster." });
    const approved = runReviewApproveCommand({ workspace, id: response.data.reviewItemId! });
    withDatabase(workspace, (db) => {
      db.exec("DROP INDEX idx_execution_runs_review_item_id_unique; DROP INDEX idx_run_artifacts_run_artifact_unique;");
      const run = getExecutionRun(db, approved.data.run!.id)!;
      const duplicateRunId = "run_duplicate_migration";
      db.prepare(
        `INSERT INTO execution_runs (
          id, work_item_id, plan_id, status, summary, mission_log_id, review_item_id,
          executor_name, pid, retry_of_run_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        duplicateRunId, run.work_item_id, run.plan_id, run.status, run.summary, null,
        run.review_item_id, run.executor_name, null, null, run.created_at, run.updated_at
      );
      const artifactId = "artifact_migration_evidence";
      db.prepare(
        `INSERT INTO artifacts (
          id, project_id, work_item_id, title, artifact_type, status, path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        artifactId, run.project_id, run.work_item_id, "Migration evidence", "diagnostic",
        "drafted", "artifacts/migration-evidence.txt", run.created_at, run.updated_at
      );
      db.prepare("INSERT INTO run_artifacts (id, run_id, artifact_id, created_at) VALUES (?, ?, ?, ?)")
        .run("link_migration_1", run.id, artifactId, run.created_at);
      db.prepare("INSERT INTO run_artifacts (id, run_id, artifact_id, created_at) VALUES (?, ?, ?, ?)")
        .run("link_migration_2", run.id, artifactId, run.created_at);

      applyMigrations(db);
      expect((db.prepare("SELECT review_item_id FROM execution_runs WHERE id = ?").get(run.id) as any).review_item_id)
        .toBe(run.review_item_id);
      expect((db.prepare("SELECT review_item_id FROM execution_runs WHERE id = ?").get(duplicateRunId) as any).review_item_id)
        .toBeNull();
      expect(scalar(db, "SELECT COUNT(*) AS count FROM run_artifacts WHERE run_id = ? AND artifact_id = ?", run.id, artifactId))
        .toBe(1);
      expect(scalar(db, "SELECT COUNT(*) AS count FROM execution_runs")).toBe(2);
      expect(scalar(db, "SELECT COUNT(*) AS count FROM artifacts WHERE id = ?", artifactId)).toBe(1);
    });
  });

  it("orphan recovery requeues unstarted attempts and fails uncertain started attempts once", () => {
    const workspace = fixtureWorkspace();
    const response = runAskCommand({ workspace, request: "Prepare a plan for adding Pinterest publishing to Rebuster." });
    const approved = runReviewApproveCommand({ workspace, id: response.data.reviewItemId! });
    const runId = approved.data.run!.id;
    const logfile = path.join(workspace, ".arcadia", "worker.log");
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE execution_runs SET status = 'running', pid = 999999 WHERE id = ?").run(runId);
      recoverOrphanedRuns(db, logfile);
      expect(getExecutionRun(db, runId)?.status).toBe("pending_execution");

      db.prepare("UPDATE execution_runs SET status = 'running', pid = 999999 WHERE id = ?").run(runId);
      db.prepare("UPDATE codex_invocations SET status = 'running' WHERE id = ?")
        .run(response.data.codexInvocations[0]!.id);
      recoverOrphanedRuns(db, logfile);
      const failed = getExecutionRun(db, runId)!;
      expect(failed.status).toBe("failed");
      expect(failed.mission_log_id).toBeTruthy();
      const logId = failed.mission_log_id;
      recoverOrphanedRuns(db, logfile);
      expect(getExecutionRun(db, runId)?.mission_log_id).toBe(logId);
    });
  });
});

function fixtureWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-decision-gate-"));
  roots.push(workspace);
  const repo = path.join(workspace, "rebuster-repo");
  mkdirSync(repo, { recursive: true });
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Rebuster",
      mission: "Create high-quality rebus puzzles.",
      goal: "Make publishing reliable.",
      status: "active",
      currentMilestone: "Reliable publishing workflow",
      nextAction: "Choose the next publishing improvement.",
      workClassification: "requires_review"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      aliases: ["Rebuster Studio"],
      repoPath: repo,
      statusSummary: "Ready for planning.",
      validationCommands: []
    });
  });
  return workspace;
}

function scalar(db: any, sql: string, ...parameters: unknown[]): number {
  return Number((db.prepare(sql).get(...parameters) as { count: number }).count);
}
