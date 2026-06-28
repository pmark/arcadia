import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  compareAndSetReviewItemStatus,
  createCodexInvocation,
  createExecutionRun,
  getArtifact,
  getCodexInvocation,
  getExecutionPlan,
  getExecutionRun,
  getExecutionRunByReviewItem,
  getReviewItem,
  getReviewItemBySlug,
  getWorkItem,
  listApprovalGatesForWorkItem,
  updateWorkItem
} from "../db/repositories.js";
import type {
  ArtifactSummary,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  ReviewItemSummary
} from "../domain/types.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export const PLANNING_APPROVAL_INTENTS = [
  "CodexPlanningRunApproval",
  "CodexPlanningRetryApproval"
] as const;

export interface PlanningDecisionContext {
  schemaVersion?: number;
  packetSha256?: string;
  priorRunId?: string;
  [key: string]: unknown;
}

export interface PlanningAuthorizationInput {
  workspace: string;
  run: ExecutionRunSummary | null;
  plan: ExecutionPlanSummary;
  decision: ReviewItemSummary | null;
  invocation: CodexInvocation | null;
  packetArtifact: ArtifactSummary | null;
}

export interface PlanningAuthorizationResult {
  authorized: boolean;
  reason: string | null;
}

export function packetSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function authorizePlanningRun(input: PlanningAuthorizationInput): PlanningAuthorizationResult {
  const planningSteps = input.plan.steps.filter((step) => step.executor_type === "codex_planning");
  if (planningSteps.length !== 1) {
    return refused("Planning authorization requires exactly one protected planning step.");
  }
  if (!input.run || input.run.status !== "running") {
    return refused("Planning authorization requires the queued Run to be running.");
  }
  if (input.run.work_item_id !== input.plan.work_item_id || input.run.plan_id !== input.plan.id) {
    return refused("Planning authorization Run does not match the Action and plan.");
  }
  if (!input.decision || !isPlanningApprovalDecision(input.decision) || input.decision.status !== "approved") {
    return refused("Planning execution requires an approved Decision for this Action, plan, and packet.");
  }
  if (input.run.review_item_id !== input.decision.id) {
    return refused("Planning Run is not linked to its approving Decision.");
  }
  if (
    input.decision.work_item_id !== input.plan.work_item_id ||
    input.decision.plan_id !== input.plan.id ||
    !input.invocation ||
    input.decision.codex_invocation_id !== input.invocation.id ||
    !input.packetArtifact ||
    input.decision.artifact_id !== input.packetArtifact.id
  ) {
    return refused("Planning Decision links do not match the Action, plan, packet Artifact, and invocation.");
  }
  if (
    input.invocation.work_item_id !== input.plan.work_item_id ||
    input.invocation.plan_id !== input.plan.id ||
    input.invocation.purpose !== "planning" ||
    input.invocation.status !== "packet_created" ||
    input.packetArtifact.path !== input.invocation.prompt_path
  ) {
    return refused("Planning invocation does not match the approved packet.");
  }
  const packetPath = path.join(input.workspace, input.invocation.prompt_path);
  if (!existsSync(packetPath)) {
    return refused(`Approved planning packet is missing: ${input.invocation.prompt_path}`);
  }
  const context = parseDecisionContext(input.decision);
  if (!context.packetSha256 || packetSha256(packetPath) !== context.packetSha256) {
    return refused("Approved planning packet digest does not match the persisted Decision.");
  }
  return { authorized: true, reason: null };
}

export function authorizePlanningRunFromRepository(
  db: Database.Database,
  workspace: string,
  input: { runId: string; planId: string; decisionId: string; invocationId: string }
): PlanningAuthorizationResult {
  const run = getExecutionRun(db, input.runId);
  const plan = getExecutionPlan(db, input.planId);
  const decision = getReviewItem(db, input.decisionId);
  const invocation = getCodexInvocation(db, input.invocationId);
  const packetArtifact = decision?.artifact_id ? getArtifact(db, decision.artifact_id) : null;
  if (!plan) {
    return refused("Planning plan is missing.");
  }
  const result = authorizePlanningRun({ workspace, run, plan, decision, invocation, packetArtifact });
  if (!result.authorized) {
    return result;
  }
  const gates = listApprovalGatesForWorkItem(db, plan.work_item_id).filter((gate) =>
    gate.plan_id === plan.id && (!gate.plan_step_id || plan.steps.some((step) => step.id === gate.plan_step_id))
  );
  if (gates.some((gate) => gate.status !== "approved")) {
    return refused("All approval gates applicable to the planning step must be approved.");
  }
  const otherRun = db.prepare(
    "SELECT id FROM execution_runs WHERE id != ? AND review_item_id = ? LIMIT 1"
  ).get(input.runId, input.decisionId) as { id: string } | undefined;
  return otherRun ? refused("The approved planning attempt is already linked to another Run.") : result;
}

export function queueApprovedPlanningRun(
  db: Database.Database,
  workspace: string,
  input: { decisionId: string; execute?: boolean; executorName?: string }
): { decision: ReviewItemSummary; run: ExecutionRunSummary | null; duplicate: boolean } {
  const transaction = db.transaction(() => {
    let decision = getReviewItem(db, input.decisionId) ?? getReviewItemBySlug(db, input.decisionId);
    if (!decision || !isPlanningApprovalDecision(decision)) {
      throw new Error("Planning approval Decision was not found.");
    }
    const existingRun = getExecutionRunByReviewItem(db, decision.id);
    if (existingRun) {
      return { decision, run: existingRun, duplicate: true };
    }
    if (!["open", "deferred", "approved"].includes(decision.status)) {
      throw new Error(`Planning Decision cannot queue a Run from status ${decision.status}.`);
    }
    const plan = decision.plan_id ? getExecutionPlan(db, decision.plan_id) : null;
    const action = decision.work_item_id ? getWorkItem(db, decision.work_item_id) : null;
    let invocation = decision.codex_invocation_id ? getCodexInvocation(db, decision.codex_invocation_id) : null;
    const artifact = decision.artifact_id ? getArtifact(db, decision.artifact_id) : null;
    if (!plan || !action || !invocation || !artifact || !decision.project_id) {
      throw new Error("Planning Decision is missing required Action, plan, Project, packet Artifact, or invocation links.");
    }
    if (
      plan.work_item_id !== action.id ||
      action.project_id !== decision.project_id ||
      invocation.work_item_id !== action.id ||
      invocation.plan_id !== plan.id ||
      artifact.work_item_id !== action.id ||
      artifact.path !== invocation.prompt_path
    ) {
      throw new Error("Planning Decision links are inconsistent.");
    }
    const packetPath = path.join(workspace, invocation.prompt_path);
    const context = parseDecisionContext(decision);
    if (!existsSync(packetPath) || !context.packetSha256 || packetSha256(packetPath) !== context.packetSha256) {
      throw new Error("Planning packet is missing or changed; regenerate it before approval.");
    }

    if (decision.resolved_intent === "CodexPlanningRetryApproval" && decision.status !== "approved") {
      const newInvocationId = createId("codexInvocation");
      invocation = createCodexInvocation(db, {
        id: newInvocationId,
        purpose: "planning",
        agentProfile: invocation.agent_profile,
        workspaceScope: invocation.workspace_scope,
        command: invocation.command,
        promptPath: invocation.prompt_path,
        jsonlOutputPath: attemptPath(invocation.jsonl_output_path, newInvocationId),
        finalMessagePath: attemptPath(invocation.final_message_path, newInvocationId),
        status: "packet_created",
        workItemId: action.id,
        planId: plan.id
      });
      db.prepare("UPDATE review_items SET codex_invocation_id = ?, updated_at = ? WHERE id = ?")
        .run(invocation.id, nowIso(), decision.id);
      decision = getReviewItem(db, decision.id) as ReviewItemSummary;
    }

    if (decision.status !== "approved") {
      decision = compareAndSetReviewItemStatus(
        db,
        decision.id,
        ["open", "deferred"],
        "approved",
        input.execute === false ? "Approved; execution not queued." : "Approved and queued for managed planning execution."
      ) ?? (() => { throw new Error("Planning Decision changed while it was being approved."); })();
    }
    if (input.execute === false) {
      return { decision, run: null, duplicate: false };
    }

    const planningStep = plan.steps.find((step) => step.executor_type === "codex_planning");
    if (!planningStep) {
      throw new Error("Planning Decision plan has no protected planning step.");
    }
    const priorRunId = typeof context.priorRunId === "string" ? context.priorRunId : null;
    const run = createExecutionRun(db, {
      workItemId: action.id,
      planId: plan.id,
      status: "pending_execution",
      summary: `Approved planning Run queued for ${decision.slug ?? decision.id}.`,
      reviewItemId: decision.id,
      executorName: input.executorName ?? invocation.agent_profile,
      retryOfRunId: priorRunId,
      steps: [{
        planStepId: planningStep.id,
        status: "pending",
        command: null,
        output: null,
        error: null,
        artifactPath: null
      }]
    });
    if (!run) {
      throw new Error("Approved planning Run could not be created.");
    }
    updateWorkItem(db, action.id, {
      queue: "work_queue",
      workClassification: "codex",
      status: "in_progress",
      nextAction: "Wait for the approved planning Run, then review its Validation and Artifact."
    });
    return { decision, run, duplicate: false };
  });
  return transaction();
}

export function isPlanningApprovalDecision(decision: Pick<ReviewItemSummary, "resolved_intent">): boolean {
  return (PLANNING_APPROVAL_INTENTS as readonly string[]).includes(decision.resolved_intent);
}

export function parseDecisionContext(decision: Pick<ReviewItemSummary, "context_json">): PlanningDecisionContext {
  try {
    const parsed = JSON.parse(decision.context_json) as unknown;
    return parsed && typeof parsed === "object" ? parsed as PlanningDecisionContext : {};
  } catch {
    return {};
  }
}

function refused(reason: string): PlanningAuthorizationResult {
  return { authorized: false, reason };
}

function attemptPath(original: string, invocationId: string): string {
  const extension = path.extname(original);
  const base = path.basename(original, extension);
  return path.join(path.dirname(original), `${base}-${invocationId}${extension}`);
}
