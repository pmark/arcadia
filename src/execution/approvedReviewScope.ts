import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  getExecutionPlan,
  getProjectMetadata,
  getWorkItem
} from "../db/repositories.js";
import type { ReviewItemSummary } from "../domain/types.js";

export const APPROVED_SCOPE_CONTEXT_KEY = "approvedExecutionScopeSha256";

export function approvedReviewScopeSha256(db: Database.Database, review: ReviewItemSummary): string {
  const action = review.work_item_id ? getWorkItem(db, review.work_item_id) : null;
  const plan = review.plan_id ? getExecutionPlan(db, review.plan_id) : null;
  const projectId = review.project_id ?? action?.project_id ?? null;
  const metadata = projectId ? getProjectMetadata(db, projectId) : null;
  const repoPath = metadata?.repo_path?.trim();
  let physicalRepoPath: string | null = null;
  if (repoPath) {
    const absolute = path.resolve(repoPath);
    try {
      physicalRepoPath = realpathSync(absolute);
    } catch {
      physicalRepoPath = absolute;
    }
  }

  const scope = {
    reviewId: review.id,
    intent: review.resolved_intent,
    sourceInput: review.source_input,
    proposedAction: review.proposed_action,
    projectId,
    physicalRepoPath,
    action: action ? {
      id: action.id,
      projectId: action.project_id,
      title: action.title,
      rawInput: action.raw_input,
      nextAction: action.next_action,
      expectedArtifact: action.expected_artifact,
      status: action.status,
      archivedAt: action.archived_at ?? null
    } : null,
    plan: plan ? {
      id: plan.id,
      workItemId: plan.work_item_id,
      status: plan.status,
      summary: plan.summary
    } : null
  };
  return createHash("sha256").update(JSON.stringify(scope), "utf8").digest("hex");
}
