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
  getProjectContext,
  getReviewItem,
  getReviewItemBySlug,
  getWorkItem,
  listApprovalGatesForWorkItem,
  updateWorkItem
} from "../db/repositories.js";
import { resolveActionReadiness, type DispatchBlocker } from "../docs/dispatch.js";
import { recordDispatchEvent } from "../docs/journal.js";
import { parseActionDocRef } from "../docs/types.js";
import type {
  ArtifactSummary,
  CodexInvocation,
  ExecutionPlanSummary,
  ExecutionRunSummary,
  ReviewItemSummary,
  WorkItemSummary
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
  /** The plan document's `updated:` field when the packet was built, if any. */
  planDocUpdated?: string | null;
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

/**
 * Recheck document readiness at approval, but only when there is a reason to
 * think it moved.
 *
 * `assertManagedDocumentReadiness` already checks readiness once, when the
 * packet is built (`work plan`). A Decision can then sit open for a while, and
 * the plan document underneath it is not immutable: a dependency can regress,
 * a required Decision can reopen, a clarification question can appear. Full
 * document readiness is a cheap read but not a free one, and most Decisions
 * are approved long before anything about their plan changes — so this trusts
 * the plan document's own `updated:` field as the signal that a recheck is
 * worth doing, rather than re-resolving readiness on every approval.
 *
 * If the packet predates this field, or the Action was never doc-backed, or
 * the plan document's `updated:` is exactly what it was when the packet was
 * built, this is a no-op. Only a document that actually moved gets re-read,
 * and even then approval is refused only if a real blocker or clarification
 * question is present now — not for every cosmetic edit that happens to bump
 * the date.
 */
function assertPlanReadinessNotRegressed(
  db: Database.Database,
  action: WorkItemSummary,
  context: PlanningDecisionContext
): void {
  const planDocUpdated = context.planDocUpdated;
  if (typeof planDocUpdated !== "string") {
    return;
  }

  const docRef = action.doc_ref?.trim();
  if (!docRef || !action.project_id) {
    return;
  }
  const parsed = parseActionDocRef(docRef);
  if (!parsed) {
    return;
  }

  const projectContext = getProjectContext(db, action.project_id);
  const repoRoot = projectContext?.metadata?.repo_path?.trim();
  const projectSlug = projectContext?.project.slug;
  if (!repoRoot || !projectSlug || !existsSync(repoRoot)) {
    return;
  }

  const readiness = resolveActionReadiness(repoRoot, projectSlug, parsed.actionId);
  if (!readiness.found || readiness.planUpdated === planDocUpdated) {
    return;
  }

  const blocked = readiness.blockers.length > 0 || readiness.operatorQuestion !== null;

  recordDispatchEvent(db, {
    command: "review.approve",
    projectId: action.project_id,
    projectSlug,
    planSlug: readiness.planSlug,
    actionId: parsed.actionId,
    dispatchable: !blocked,
    blockers: readiness.blockers,
    operatorQuestion: readiness.operatorQuestion
  });

  if (readiness.operatorQuestion) {
    throw new Error(
      `Plan document changed since this packet was built; "${parsed.actionId}" now has an open clarification ` +
        `question: ${readiness.operatorQuestion} Answer it, then rebuild the packet.`
    );
  }

  if (blocked) {
    const summary = readiness.blockers
      .map((blocker: DispatchBlocker) => `${blocker.field}: ${blocker.message}`)
      .join("; ");
    throw new Error(
      `Plan document changed since this packet was built, and "${parsed.actionId}" is no longer ready: ${summary}. ` +
        "Rebuild the packet."
    );
  }
}

export function queueApprovedPlanningRun(
  db: Database.Database,
  workspace: string,
  input: { decisionId: string; execute?: boolean; executorName?: string }
): { decision: ReviewItemSummary; run: ExecutionRunSummary | null; duplicate: boolean } {
  // Outside the transaction, for the same reason `work plan`'s guard runs
  // before its own: a refusal that journals its own resolution and then rolls
  // that journal entry back with everything else answers nothing.
  const preDecision = getReviewItem(db, input.decisionId) ?? getReviewItemBySlug(db, input.decisionId);
  if (preDecision && isPlanningApprovalDecision(preDecision)) {
    const preAction = preDecision.work_item_id ? getWorkItem(db, preDecision.work_item_id) : null;
    if (preAction) {
      assertPlanReadinessNotRegressed(db, preAction, parseDecisionContext(preDecision));
    }
  }

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
        planId: plan.id,
        executionProfileJson: invocation.execution_profile_json,
        providerMappingId: invocation.provider_mapping_id,
        providerBindingId: invocation.provider_binding_id
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
      executionProfileJson: invocation.execution_profile_json,
      providerMappingId: invocation.provider_mapping_id,
      providerBindingId: invocation.provider_binding_id,
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
