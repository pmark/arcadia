import type Database from "better-sqlite3";
import type { ExecutionRunSummary, ReviewItemSummary } from "../domain/types.js";
import { attachArtifactToExecutionRun, getExecutionRun, updateWorkItem } from "../db/repositories.js";
import { executeApprovedReview, type ReviewExecutionResult } from "./reviewExecutor.js";
import { reduceExecutionOutcome, finalizeGenericRun, finalizeWorkerFailure } from "./runFinalization.js";
import { deployApprovedProjectProposal } from "../projects/stagingDeployment.js";
import type { ScoutReservation, AdmissionScope } from "../scout/runAdmission.js";

/** Execute an already claimed approved Run; no scheduling, recovery or intake. */
export function executeClaimedReviewRun(db: Database.Database, workspacePath: string, run: ExecutionRunSummary, decision: ReviewItemSummary, options: {
  fixtureScript?: string;
  scoutReservation?: ScoutReservation;
  scoutScope?: AdmissionScope;
  acceptProduct?: (result: ReviewExecutionResult) => void;
  log?: (message: string) => void;
} = {}) {
  try {
    const result = executeApprovedReview(db, {
      workspace: workspacePath,
      reviewId: decision.id,
      executorName: run.executor_name ?? undefined,
      runId: run.id,
      fixtureScript: options.fixtureScript,
      scoutReservation: options.scoutReservation,
      scoutScope: options.scoutScope
    });
    const status = reduceExecutionOutcome(result);
    attachArtifactToExecutionRun(db, run.id, result.artifact.id);
    if (status === "completed") options.acceptProduct?.(result);
    let stagingUrl: string | null = null;
    if (decision.resolved_intent === "ProjectProposalApproval" && status === "completed") {
      if (!decision.project_id) {
        throw new Error("Approved Project proposal is missing its Project id.");
      }
      const deployment = deployApprovedProjectProposal(db, {
        projectId: decision.project_id,
        workItemId: result.workItemId,
        repoPath: result.repoPath
      });
      stagingUrl = deployment.url;
      attachArtifactToExecutionRun(db, run.id, deployment.artifact.id);
    }
    const summary = [
      `Executed with ${result.executor}.`,
      result.error ? `Executor error: ${result.error}.` : "",
      result.signal ? `Executor signal: ${result.signal}.` : "",
      `${result.changedFiles.length} file(s) changed.`,
      `Validation: ${status === "completed" ? "passed" : status === "requires_review" ? "failed" : "not run"}.`,
      stagingUrl ? `Live staging URL: ${stagingUrl}.` : `Follow-up Decision: ${result.followUpReview.slug ?? result.followUpReview.id}.`
    ].filter(Boolean).join(" ");
    finalizeGenericRun(db, workspacePath, run.id, status, summary, result.artifact.path ?? result.metadataPath);
    if (stagingUrl && result.workItemId) {
      updateWorkItem(db, result.workItemId, {
        queue: "work_queue",
        workClassification: "agent",
        status: "done",
        nextAction: `Review the live staging site at ${stagingUrl}.`
      });
    }
    options.log?.(`Run ${run.id} ${status} (exit: ${result.exitStatus})`);
  } catch (error) {
    finalizeWorkerFailure(db, workspacePath, run.id, error instanceof Error ? error.message : String(error));
  }
  return getExecutionRun(db, run.id);
}
