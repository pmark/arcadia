import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  buildStatusReportData,
  buildWeeklyReviewData,
  createReviewExecutionRun,
  createReviewItem,
  createReviewFeedback,
  getProjectMetadata,
  getExecutionRun,
  getReviewItem,
  getReviewItemBySlug,
  getWorkItem,
  listActionableReviewItems,
  updateArtifact,
  updateReviewItemStatus,
  updateWorkItem
} from "../db/repositories.js";
import type { ReviewFeedback, ReviewItemSummary } from "../domain/types.js";
import { executeApprovedReview, type ReviewExecutionResult } from "../execution/reviewExecutor.js";
import { isPlanningApprovalDecision, queueApprovedPlanningRun } from "../execution/planningAuthorization.js";
import { parseDecisionContext } from "../execution/planningAuthorization.js";
import { writeWeeklyReviewReport } from "../markdown/weeklyReview.js";
import {
  REVIEW_FEEDBACK_TYPES,
  normalizeReviewResponseValue,
  parseReviewResponse,
  type ParsedReviewResponse
} from "../review/responseParser.js";
import { localDateStamp } from "../utils/time.js";
import { runAskCommand, type AskCommandData } from "./ask.js";

export interface RequiresReviewPacket {
  id: string;
  slug: string;
  decisionId: string;
  decisionSlug: string;
  workItemId: string | null;
  actionId: string | null;
  projectId: string | null;
  project: string | null;
  goal: string | null;
  outcome: string | null;
  status: ReviewItemSummary["status"];
  category: string;
  resolvedIntent: string;
  decisionNeeded: string;
  context: string;
  contextJson: string | null;
  recommendation: string | null;
  proposedAction: string;
  missingFields: string[];
  options: string[];
  sourceInput: string;
  createdAt: string;
  updatedAt: string;
  resultingAskRequestId: string | null;
  packetArtifactId: string | null;
  codexInvocationId: string | null;
  artifactPath: string | null;
  promptPath: string | null;
  finalMessagePath: string | null;
  validationPath: string | null;
}

export interface ReviewRequiredCommandOptions {
  workspace: string;
}

export interface ReviewRequiredCommandData {
  count: number;
  items: RequiresReviewPacket[];
}

export interface ReviewShowCommandOptions {
  workspace: string;
  id: string;
}

export interface ReviewShowCommandData {
  item: RequiresReviewPacket;
}

export interface ReviewDecisionCommandOptions {
  workspace: string;
  id: string;
  execute?: boolean;
  executor?: string;
}

export interface ReviewDecisionCommandData {
  item: RequiresReviewPacket;
  result: {
    status: "approved" | "rejected" | "deferred" | "pending_execution";
    summary: string;
  };
  approval: AskCommandData | null;
  execution: ReviewExecutionPacket | null;
  run: { id: string } | null;
}

export interface ReviewExecutionPacket {
  executor: string;
  command: string[];
  repoPath: string;
  workItemId: string | null;
  followUpReviewItemId: string;
  followUpReviewSlug: string;
  startedAt: string;
  endedAt: string;
  exitStatus: number | null;
  changedFiles: string[];
  validation: Array<{
    command: string;
    exitStatus: number | null;
    error: string | null;
  }>;
  finalOutput: string | null;
  metadataPath: string;
  artifactPaths: string[];
}

export interface ReviewResolveReplyCommandOptions {
  workspace: string;
  reply: string;
  id?: string | null;
  execute?: boolean;
  executor?: string;
}

export interface ReviewResolveReplyCommandData {
  item: RequiresReviewPacket;
  action: "approved" | "rejected" | "deferred" | "feedback_captured" | "pending_execution";
  selectedOption: string | null;
  feedback: ReviewFeedback | null;
  result: ReviewDecisionCommandData["result"] | null;
  approval: AskCommandData | null;
  execution: ReviewExecutionPacket | null;
  run: { id: string } | null;
  confirmation: string;
}

export interface ReviewWeeklyCommandOptions {
  workspace: string;
  since?: string;
  until?: string;
}

export interface ReviewWeeklyCommandData {
  reportPath: string;
  window: {
    since: string;
    until: string;
  };
  counts: {
    completedWork: number;
    missionLogs: number;
    blockedWork: number;
    requiresReview: number;
    codexWork: number;
    autonomousWork: number;
    artifacts: number;
    projectsWithoutOpenNextActions: number;
    suggestedNextActions: number;
  };
}

export function runReviewRequiredCommand(
  options: ReviewRequiredCommandOptions
): CommandSuccess<ReviewRequiredCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const items = withDatabase(workspacePath, (db) => {
    return listActionableReviewItems(db).map(reviewPacketForReviewItem);
  });

  return createSuccess({
    command: "review",
    workspace: workspacePath,
    data: {
      count: items.length,
      items
    }
  });
}

export function runReviewShowCommand(
  options: ReviewShowCommandOptions
): CommandSuccess<ReviewShowCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const item = withDatabase(workspacePath, (db) => {
    const reviewItem = getReviewItemByIdOrSlug(db, options.id);
    if (reviewItem) {
      return reviewPacketForReviewItem(reviewItem);
    }
    throw validationError("Requires Review Decision was not found.", { id: options.id });
  });

  return createSuccess({
    command: "review.show",
    workspace: workspacePath,
    data: { item }
  });
}

export function runReviewResolveReplyCommand(
  options: ReviewResolveReplyCommandOptions
): CommandSuccess<ReviewResolveReplyCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const parsed = parseReviewResponse(options.reply);
  const reviewItem = withDatabase(workspacePath, (db) => {
    const item = options.id
      ? getReviewItem(db, options.id)
      : parsed.reviewId
        ? getReviewItem(db, parsed.reviewId)
        : parsed.reviewSlug
        ? getReviewItemBySlug(db, parsed.reviewSlug)
        : null;
    if (!item) {
      throw validationError("Requires Review Decision was not found.", {
        id: options.id ?? parsed.reviewId ?? parsed.reviewSlug ?? null
      });
    }
    if (item.status !== "open" && item.status !== "deferred") {
      throw validationError("Requires Review Decision is already decided.", { id: item.id, status: item.status });
    }
    return item;
  });
  const packet = reviewPacketForReviewItem(reviewItem);

  const feedbackType = parsed.feedbackType;
  if (feedbackType) {
    const feedback = withDatabase(workspacePath, (db) =>
      createReviewFeedback(db, {
        reviewId: reviewItem.id,
        reviewSlug: packet.slug,
        sourceInput: reviewItem.source_input,
        proposedInterpretation: reviewItem.proposed_action,
        feedbackType,
        rawReply: options.reply
      })
    );
    return createSuccess({
      command: "review.resolve-reply",
      workspace: workspacePath,
      data: {
        item: packet,
        action: "feedback_captured",
        selectedOption: null,
        feedback,
        result: null,
        approval: null,
        execution: null,
        run: null,
        confirmation: `Feedback captured for ${packet.slug}: ${feedback.feedback_type}.`
      }
    });
  }

  const decision = resolveReplyDecision(parsed, packet);
  if (!decision) {
    throw validationError("Invalid Requires Review reply.", {
      reply: options.reply,
      validReplies: validRepliesForReview(packet)
    });
  }

  const response =
    decision === "approve"
      ? runReviewApproveCommand({ workspace: workspacePath, id: reviewItem.id, execute: options.execute, executor: options.executor })
      : decision === "reject"
        ? runReviewRejectCommand({ workspace: workspacePath, id: reviewItem.id })
        : runReviewDeferCommand({ workspace: workspacePath, id: reviewItem.id });
  const updated = response.data.item;

  return createSuccess({
    command: "review.resolve-reply",
    workspace: workspacePath,
    data: {
      item: updated,
      action: response.data.result.status,
      selectedOption: decision,
      feedback: null,
      result: response.data.result,
      approval: response.data.approval,
      execution: response.data.execution,
      run: response.data.run,
      confirmation: confirmationForDecision(updated, decision, response.data.result.summary)
    },
    artifacts: response.artifacts
  });
}

export function runReviewApproveCommand(
  options: ReviewDecisionCommandOptions
): CommandSuccess<ReviewDecisionCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const specialized = withDatabase(workspacePath, (db) => getReviewItemByIdOrSlug(db, options.id));
  if (specialized && isPlanningApprovalDecision(specialized)) {
    try {
      const queued = withDatabase(workspacePath, (db) => queueApprovedPlanningRun(db, workspacePath, {
        decisionId: specialized.id,
        execute: options.execute !== false,
        executorName: options.executor
      }));
      return createSuccess({
        command: "review.approve",
        workspace: workspacePath,
        data: {
          item: reviewPacketForReviewItem(queued.decision),
          result: {
            status: queued.run ? "pending_execution" : "approved",
            summary: queued.run
              ? `Managed planning Run ${queued.run.id} ${queued.duplicate ? "already queued" : "queued"}.`
              : "Planning Decision approved without queueing execution."
          },
          approval: null,
          execution: null,
          run: queued.run ? { id: queued.run.id } : null
        }
      });
    } catch (error) {
      throw validationError(error instanceof Error ? error.message : String(error), { id: specialized.id, conflict: true });
    }
  }
  if (specialized?.resolved_intent === "CodexPlanningArtifactAcceptance") {
    const updated = withDatabase(workspacePath, (db) => {
      if (specialized.status !== "open" && specialized.status !== "deferred") {
        throw validationError("Plan acceptance Decision is already decided.", { id: specialized.id, status: specialized.status });
      }
      if (!specialized.artifact_id || !specialized.work_item_id) {
        throw validationError("Plan acceptance Decision is missing its Artifact or Action.", { id: specialized.id });
      }
      updateArtifact(db, specialized.artifact_id, { status: "ready" });
      updateWorkItem(db, specialized.work_item_id, {
        queue: "work_queue",
        workClassification: "needs_mark",
        status: "done",
        nextAction: "Plan accepted; choose the next implementation Action when ready."
      });
      return updateReviewItemStatus(db, specialized.id, {
        status: "approved",
        decisionNote: "Validated planning Artifact accepted."
      }) as ReviewItemSummary;
    });
    return createSuccess({
      command: "review.approve",
      workspace: workspacePath,
      data: {
        item: reviewPacketForReviewItem(updated),
        result: { status: "approved", summary: "Validated planning Artifact accepted; no executor was invoked." },
        approval: null,
        execution: null,
        run: null
      }
    });
  }
  if (specialized?.resolved_intent === "codex_planning_artifact_validation") {
    const created = withDatabase(workspacePath, (db) => {
      const runId = parseDecisionContext(specialized).runId;
      const run = typeof runId === "string" ? getExecutionRun(db, runId) : null;
      const approval = run?.review_item_id ? getReviewItem(db, run.review_item_id) : null;
      if (!run || !approval || !isPlanningApprovalDecision(approval)) {
        throw validationError("Validation recovery Decision is missing its source planning Run.", {
          id: specialized.id,
          conflict: true
        });
      }
      const existing = listActionableReviewItems(db).find((item) =>
        item.resolved_intent === "CodexPlanningRetryApproval" &&
        parseDecisionContext(item).priorRunId === run.id
      );
      const retry = existing ?? createReviewItem(db, {
        workItemId: approval.work_item_id,
        planId: approval.plan_id,
        projectId: approval.project_id,
        artifactId: approval.artifact_id,
        codexInvocationId: approval.codex_invocation_id,
        decisionNeeded: `Approve a revised immutable planning attempt after failed Validation for Run ${run.id}.`,
        recommendation: "Review the Validation evidence, then approve a retry.",
        sourceInput: approval.source_input,
        proposedAction: "Queue a new planning attempt using the unchanged approved packet.",
        resolvedIntent: "CodexPlanningRetryApproval",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {
          ...parseDecisionContext(approval),
          schemaVersion: 1,
          priorRunId: run.id,
          failureEvidence: run.artifacts.map((artifact) => artifact.path ?? artifact.title),
          recommendedCorrection: specialized.decision_needed
        }
      });
      const updated = updateReviewItemStatus(db, specialized.id, {
        status: "approved",
        decisionNote: `Recovery routed to retry Decision ${retry.slug ?? retry.id}.`
      }) as ReviewItemSummary;
      if (specialized.work_item_id) {
        updateWorkItem(db, specialized.work_item_id, {
          queue: "needs_mark",
          workClassification: "needs_mark",
          status: "in_progress",
          nextAction: "Review and approve or reject the retry Decision."
        });
      }
      return { updated, retry };
    });
    return createSuccess({
      command: "review.approve",
      workspace: workspacePath,
      data: {
        item: reviewPacketForReviewItem(created.updated),
        result: {
          status: "approved",
          summary: `Retry Decision ${created.retry.slug ?? created.retry.id} created; no executor was invoked.`
        },
        approval: null,
        execution: null,
        run: null
      }
    });
  }
  if (options.execute !== false) {
    return runReviewApproveExecuteCommand({ ...options, workspace: workspacePath });
  }

  const reviewItem = withDatabase(workspacePath, (db) => {
    const item = getReviewItemByIdOrSlug(db, options.id);
    if (!item) {
      throw validationError("Requires Review Decision was not found.", { id: options.id });
    }
    if (item.status !== "open" && item.status !== "deferred") {
      throw validationError("Requires Review Decision is already decided.", { id: item.id, status: item.status });
    }
    return item;
  });

  const approval = runAskCommand({
    workspace: workspacePath,
    request: reviewItem.source_input,
    approvedReviewItemId: reviewItem.id
  });
  if (!approval.data.ask) {
    throw validationError("Approved Requires Review Decision did not produce an ask request.", { id: reviewItem.id });
  }
  const approvalAskId = approval.data.ask.id;

  const { updated, pendingExecutionReview } = withDatabase(workspacePath, (db) => {
    const item = updateReviewItemStatus(db, reviewItem.id, {
      status: "approved",
      decisionNote: "Approved from Requires Review. Execution pending.",
      resultingAskRequestId: approvalAskId
    });
    if (!item) {
      throw validationError("Requires Review Decision was not found.", { id: reviewItem.id });
    }
    return {
      updated: item,
      pendingExecutionReview: createPendingExecutionReviewItem(db, item)
    };
  });

  return createSuccess({
    command: "review.approve",
    workspace: workspacePath,
    data: {
      item: reviewPacketForReviewItem(updated),
      result: {
        status: "approved",
        summary: `${approval.data.result.summary} Run pending as Requires Review Decision ${pendingExecutionReview.slug ?? pendingExecutionReview.id}.`
      },
      approval: approval.data,
      execution: null,
      run: null
    },
    artifacts: approval.artifacts,
    warnings: [`Execution was not run. Approve ${pendingExecutionReview.slug ?? pendingExecutionReview.id} to execute the approved work.`]
  });
}

function runReviewApproveExecuteCommand(
  options: ReviewDecisionCommandOptions
): CommandSuccess<ReviewDecisionCommandData> {
  const { run, review } = withDatabase(options.workspace, (db) => {
    const reviewItem = getReviewItem(db, options.id) ?? getReviewItemBySlug(db, options.id);
    if (!reviewItem) {
      throw validationError("Requires Review Decision was not found.", { id: options.id });
    }
    if (reviewItem.status !== "open" && reviewItem.status !== "deferred") {
      throw validationError("Requires Review Decision is already decided.", { id: reviewItem.id, status: reviewItem.status });
    }

    // Validate repo path upfront so the user gets an error immediately, not when the worker runs.
    const projectId = reviewItem.project_id
      ?? (reviewItem.work_item_id ? (getWorkItem(db, reviewItem.work_item_id)?.project_id ?? null) : null);
    if (projectId) {
      const meta = getProjectMetadata(db, projectId);
      const repoPath = meta?.repo_path?.trim();
      if (!repoPath) {
        throw validationError("Review execution requires project repository metadata.", { reviewId: reviewItem.id, field: "repo_path" });
      }
      const absolute = path.resolve(repoPath);
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
        throw validationError("Review execution refused because the project repository path is missing or invalid.", {
          reviewId: reviewItem.id,
          repoPath: absolute
        });
      }
      realpathSync(absolute); // resolves symlinks — validates the path is real
    }

    const executorName = options.executor ?? "codex";
    const pendingRun = createReviewExecutionRun(db, {
      reviewItemId: reviewItem.id,
      executorName,
      workItemId: reviewItem.work_item_id,
      planId: reviewItem.plan_id,
      summary: `Execution queued for ${reviewItem.slug ?? reviewItem.id} with ${executorName}.`
    });

    return { run: pendingRun, review: reviewItem };
  });

  return createSuccess({
    command: "review.approve",
    workspace: options.workspace,
    data: {
      item: reviewPacketForReviewItem(review),
      result: {
        status: "pending_execution",
        summary: `Execution queued as run ${run.id}. Start the worker to execute: arcadia worker start`
      },
      approval: null,
      execution: null,
      run: { id: run.id }
    },
    artifacts: []
  });
}

function createPendingExecutionReviewItem(
  db: Parameters<typeof createReviewItem>[0],
  approvedReview: ReviewItemSummary
): ReviewItemSummary {
  return createReviewItem(db, {
    askRequestId: approvedReview.ask_request_id,
    workItemId: approvedReview.work_item_id,
    planId: approvedReview.plan_id,
    projectId: approvedReview.project_id,
    decisionNeeded: "Execute approved work.",
    recommendation: `Approve this item to run the executor for ${approvedReview.slug ?? approvedReview.id}.`,
    sourceInput: approvedReview.source_input,
    proposedAction: `Run approved review execution for ${approvedReview.slug ?? approvedReview.id}. CLI: pnpm arcadia review approve ${approvedReview.slug ?? approvedReview.id} --execute`,
    resolvedIntent: "ReviewExecutionPending",
    confidenceLabel: "high",
    confidence: 1,
    missingFields: [],
    context: {
      originalReviewId: approvedReview.id,
      originalReviewSlug: approvedReview.slug,
      triggerCommand: `pnpm arcadia review approve ${approvedReview.slug ?? approvedReview.id} --execute`
    }
  });
}

export function runReviewRejectCommand(
  options: ReviewDecisionCommandOptions
): CommandSuccess<ReviewDecisionCommandData> {
  return runReviewDecisionCommand(options, "rejected", "Rejected without executing the proposed action.");
}

export function runReviewDeferCommand(
  options: ReviewDecisionCommandOptions
): CommandSuccess<ReviewDecisionCommandData> {
  return runReviewDecisionCommand(options, "deferred", "Deferred for future review.");
}

export function runReviewWeeklyCommand(
  options: ReviewWeeklyCommandOptions
): CommandSuccess<ReviewWeeklyCommandData> {
  const window = resolveReviewWindow(options);
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { data, reportPath } = withDatabase(workspacePath, (db) => {
    const reviewData = buildWeeklyReviewData(db, workspacePath, window);
    return {
      data: reviewData,
      reportPath: writeWeeklyReviewReport(workspacePath, reviewData)
    };
  });

  return createSuccess({
    command: "review.weekly",
    workspace: workspacePath,
    data: {
      reportPath,
      window,
      counts: {
        completedWork: data.completedWorkItems.length,
        missionLogs: data.missionLogs.length,
        blockedWork: data.blockedItems.length,
        requiresReview: data.needsMarkItems.length,
        codexWork: data.codexItems.length,
        autonomousWork: data.autonomousItems.length,
        artifacts: data.artifactItems.length,
        projectsWithoutOpenNextActions: data.projectsWithoutOpenNextActions.length,
        suggestedNextActions: data.suggestedNextActions.length
      }
    },
    artifacts: [reportPath]
  });
}

export function renderReviewWeeklySuccess(response: CommandSuccess<ReviewWeeklyCommandData>): string[] {
  return [
    "Weekly review written.",
    `Window: ${response.data.window.since} to ${response.data.window.until}`,
    `Report: ${response.data.reportPath}`
  ];
}

export function renderReviewRequiredSuccess(response: CommandSuccess<ReviewRequiredCommandData>): string[] {
  const lines = ["Arcadia Requires Review", `Decisions: ${response.data.count}`];
  if (response.data.items.length === 0) {
    lines.push("None");
    return lines;
  }

  for (const item of response.data.items) {
    lines.push("");
    lines.push(`- ${item.id}: ${item.context}`);
    lines.push(`  Project: ${item.project ?? "None"}`);
    lines.push(`  Outcome: ${item.outcome ?? "None"}`);
    lines.push(`  Decision needed: ${item.decisionNeeded}`);
    lines.push(`  Recommendation: ${item.recommendation ?? "Clarify the request before execution."}`);
    lines.push(`  Options: ${item.options.join("; ")}`);
    lines.push(`  Source input: ${item.sourceInput}`);
  }

  return lines;
}

export function renderReviewShowSuccess(response: CommandSuccess<ReviewShowCommandData>): string[] {
  const item = response.data.item;
  return [
    "Arcadia Requires Review",
    `ID: ${item.id}`,
    `Slug: ${item.slug}`,
    `Project: ${item.project ?? "None"}`,
    `Project outcome: ${item.outcome ?? "None"}`,
    `Decision needed: ${item.decisionNeeded}`,
    `Recommendation: ${item.recommendation ?? "Clarify the request before execution."}`,
    `Source input: ${item.sourceInput}`,
    `Context: ${item.context}`,
    `Options: ${item.options.join("; ")}`
  ];
}

export function renderReviewDecisionSuccess(response: CommandSuccess<ReviewDecisionCommandData>): string[] {
  const lines = [
    `Decision ${response.data.result.status}.`,
    `ID: ${response.data.item.id}`,
    `Slug: ${response.data.item.slug}`,
    `Result: ${response.data.result.summary}`
  ];
  if (response.data.approval?.workItem) {
    lines.push(`Action: ${response.data.approval.workItem.id}`);
  }
  if (response.data.approval?.plan) {
    lines.push(`Plan: ${response.data.approval.plan.id}`);
  }
  if (response.data.execution) {
    lines.push(`Executor: ${response.data.execution.executor}`);
    lines.push(`Repo: ${response.data.execution.repoPath}`);
    lines.push(`Exit status: ${response.data.execution.exitStatus ?? "unknown"}`);
    lines.push(`Changed files: ${response.data.execution.changedFiles.length > 0 ? response.data.execution.changedFiles.join(", ") : "None"}`);
    lines.push(`Follow-up review: ${response.data.execution.followUpReviewSlug}`);
    lines.push(`Metadata: ${response.data.execution.metadataPath}`);
  }
  return lines;
}

export function renderReviewResolveReplySuccess(response: CommandSuccess<ReviewResolveReplyCommandData>): string[] {
  return [response.data.confirmation];
}

function resolveReviewWindow(options: ReviewWeeklyCommandOptions): { since: string; until: string } {
  const untilDate = options.until ? parseDateOption("until", options.until) : todayLocalDate();
  const sinceDate = options.since ? parseDateOption("since", options.since) : addDays(untilDate, -6);

  if (sinceDate.getTime() > untilDate.getTime()) {
    throw validationError("Review window since date must be on or before until date.", {
      since: localDateStamp(sinceDate),
      until: localDateStamp(untilDate)
    });
  }

  return {
    since: localDateStamp(sinceDate),
    until: localDateStamp(untilDate)
  };
}

function parseDateOption(field: "since" | "until", value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`Invalid ${field} date. Expected YYYY-MM-DD.`, { field, value });
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw validationError(`Invalid ${field} date. Expected YYYY-MM-DD.`, { field, value });
  }

  return date;
}

export function reviewPacketForReviewItem(item: ReviewItemSummary): RequiresReviewPacket {
  return {
    id: item.id,
    slug: item.slug ?? item.id,
    decisionId: item.id,
    decisionSlug: item.slug ?? item.id,
    workItemId: item.work_item_id,
    actionId: item.work_item_id,
    projectId: item.project_id,
    project: item.project_name,
    goal: item.project_goal,
    outcome: item.project_outcome ?? item.project_goal,
    status: item.status,
    category: item.resolved_intent,
    resolvedIntent: item.resolved_intent,
    decisionNeeded: item.decision_needed,
    context: `${item.resolved_intent}: ${item.proposed_action}`,
    contextJson: item.context_json || null,
    recommendation: item.recommendation,
    proposedAction: item.proposed_action,
    missingFields: parseStringArray(item.missing_fields),
    options: ["approve", "reject", "defer"],
    sourceInput: item.source_input,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    resultingAskRequestId: item.resulting_ask_request_id,
    packetArtifactId: item.artifact_id,
    codexInvocationId: item.codex_invocation_id,
    artifactPath: item.artifact_path,
    promptPath: item.codex_prompt_path,
    finalMessagePath: item.codex_final_message_path,
    validationPath: validationPathFromReview(item)
  };
}

function validationPathFromReview(item: ReviewItemSummary): string | null {
  const context = parseDecisionContext(item);
  if (typeof context.validationResultPath === "string") {
    return context.validationResultPath;
  }
  return item.codex_final_message_path
    ? path.join(path.dirname(item.codex_final_message_path), "planning-validation.json")
    : null;
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function resolveReplyDecision(parsed: ParsedReviewResponse, item: RequiresReviewPacket): "approve" | "reject" | "defer" | null {
  const normalized = normalizeReviewResponseValue(parsed.value);
  if (!normalized) {
    return null;
  }

  if (parsed.optionLetter) {
    const index = parsed.optionLetter.charCodeAt(0) - "A".charCodeAt(0);
    const option = item.options[index];
    return decisionForOption(option);
  }

  if (parsed.decisionToken && item.options.includes(parsed.decisionToken)) {
    return parsed.decisionToken;
  }

  return decisionForOption(normalized);
}

export function validRepliesForReview(item: RequiresReviewPacket): string[] {
  const letters = item.options.map((_, index) => String.fromCharCode("A".charCodeAt(0) + index));
  const words = [
    item.options.includes("approve") ? "approve" : null,
    item.options.includes("reject") ? "reject" : null,
    item.options.includes("defer") ? "defer" : null
  ].filter((value): value is string => Boolean(value));
  return [...letters, ...words, ...REVIEW_FEEDBACK_TYPES];
}

function decisionForOption(option: string | undefined): "approve" | "reject" | "defer" | null {
  const normalized = normalizeReviewResponseValue(option ?? "");
  if (normalized === "approve") {
    return "approve";
  }
  if (normalized === "reject") {
    return "reject";
  }
  if (normalized === "defer") {
    return "defer";
  }
  return null;
}

function confirmationForDecision(item: RequiresReviewPacket, decision: "approve" | "reject" | "defer", summary: string): string {
  if (decision === "approve") {
    return `${item.slug} approved. Resuming execution.`;
  }
  if (decision === "reject") {
    return `${item.slug} rejected.`;
  }
  if (decision === "defer") {
    return `${item.slug} deferred.`;
  }
  return `${item.slug} resolved: ${summary}`;
}

function runReviewDecisionCommand(
  options: ReviewDecisionCommandOptions,
  status: "rejected" | "deferred",
  summary: string
): CommandSuccess<ReviewDecisionCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const updated = withDatabase(workspacePath, (db) => {
    const item = getReviewItemByIdOrSlug(db, options.id);
    if (!item) {
      throw validationError("Requires Review Decision was not found.", { id: options.id });
    }
    if (item.status !== "open" && item.status !== "deferred") {
      throw validationError("Requires Review Decision is already decided.", { id: item.id, status: item.status });
    }
    const next = updateReviewItemStatus(db, item.id, {
      status,
      decisionNote: summary
    });
    if (!next) {
      throw validationError("Requires Review Decision was not found.", { id: item.id });
    }
    if (item.work_item_id && [
      "CodexPlanningRunApproval",
      "CodexPlanningRetryApproval",
      "CodexPlanningArtifactAcceptance",
      "codex_planning_artifact_validation"
    ].includes(item.resolved_intent)) {
      updateWorkItem(db, item.work_item_id, {
        queue: "needs_mark",
        workClassification: "needs_mark",
        status: "in_progress",
        nextAction: status === "deferred"
          ? "Return to the deferred planning Decision when ready."
          : item.resolved_intent === "CodexPlanningArtifactAcceptance"
            ? "Revise or retry the planning Run."
            : "Revise the planning request or packet before creating a new Decision."
      });
    }
    return next;
  });

  return createSuccess({
    command: `review.${status === "rejected" ? "reject" : "defer"}`,
    workspace: workspacePath,
    data: {
      item: reviewPacketForReviewItem(updated),
      result: { status, summary },
      approval: null,
      execution: null,
      run: null
    }
  });
}

function reviewExecutionPacket(result: ReviewExecutionResult): ReviewExecutionPacket {
  return {
    executor: result.executor,
    command: result.command,
    repoPath: result.repoPath,
    workItemId: result.workItemId,
    followUpReviewItemId: result.followUpReview.id,
    followUpReviewSlug: result.followUpReview.slug ?? result.followUpReview.id,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    exitStatus: result.exitStatus,
    changedFiles: result.changedFiles,
    validation: result.validation.map((validation) => ({
      command: validation.command,
      exitStatus: validation.exitStatus,
      error: validation.error
    })),
    finalOutput: result.finalOutput,
    metadataPath: result.metadataPath,
    artifactPaths: result.artifactPaths
  };
}

function getReviewItemByIdOrSlug(db: Parameters<typeof getReviewItem>[0], idOrSlug: string): ReviewItemSummary | null {
  return getReviewItem(db, idOrSlug) ?? getReviewItemBySlug(db, idOrSlug);
}

function todayLocalDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
