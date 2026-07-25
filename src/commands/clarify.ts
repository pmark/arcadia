import { clarifyEngineUnavailable, workItemNotFound } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import type Database from "better-sqlite3";
import { openDatabase, withDatabase } from "../db/connection.js";
import { getWorkItem, listWorkItems, updateWorkItem } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";
import { queueForWorkClassification } from "../domain/constants.js";
import { RESPONSIBILITY_FOR_ACTOR } from "../clarify/contract.js";
import {
  createIntelligenceEvaluator,
  ClarifyEngineUnavailableError,
  ClarifyVerdictUnusableError
} from "../clarify/engine.js";
import type { ClarifyApplication, ClarifyEvaluation, ClarifyEvaluator } from "../clarify/types.js";
import { runReviewOpenCommand } from "./review.js";

export interface ClarifyCommandOptions {
  workspace: string;
  projectId?: string;
  workId?: string;
  apply?: boolean;
  limit?: number;
  /** Injectable for tests and a future `--engine` escape hatch. */
  evaluator?: ClarifyEvaluator;
}

export interface ClarifySkippedAction {
  workItemId: string;
  title: string;
  reason: string;
}

export interface ClarifyCommandData {
  applied: boolean;
  evaluated: ClarifyEvaluation[];
  applications: ClarifyApplication[];
  skipped: ClarifySkippedAction[];
}

/**
 * Which Actions a pass considers.
 *
 * `unclarified` only — not NULL. A NULL `clarification_status` means the Action
 * predates clarification entirely, and sweeping every historical row into a
 * model pass the first time this runs would be a surprise, not a feature. Done
 * Actions are excluded for the obvious reason.
 */
function needsClarification(item: WorkItemSummary): boolean {
  return item.clarification_status === "unclarified" && item.status !== "done";
}

/**
 * The deterministic, callable step between `capture` and the queue.
 *
 * Dry-run by default: the pass prints what it would write and changes nothing.
 * `--apply` persists. That default matters because clarification rewrites
 * `next_action` and Responsibility — the two fields that decide whether work
 * gets dispatched — and a batch pass that silently re-routed a queue would be
 * exactly the kind of unobservable automation this system is built to avoid.
 */
export async function runClarifyCommand(
  options: ClarifyCommandOptions
): Promise<CommandSuccess<ClarifyCommandData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const candidates = withDatabase(workspacePath, (db) => {
    if (options.workId) {
      const item = getWorkItem(db, options.workId);
      if (!item) {
        throw workItemNotFound(options.workId);
      }
      // An explicitly named Action is evaluated even if a previous pass already
      // clarified it — that is what asking for it by id means.
      return [item];
    }

    return listWorkItems(db)
      .filter(needsClarification)
      .filter((item) => !options.projectId || item.project_id === options.projectId)
      .slice(0, options.limit && options.limit > 0 ? options.limit : undefined);
  });

  // The Intelligence evaluator runs jobs against the database for as long as
  // the pass lasts, so it cannot be built inside a `withDatabase` callback —
  // that closes the connection the moment the callback returns. This one is
  // owned by the loop below and closed in its `finally`.
  const db = options.evaluator ? null : openDatabase(workspacePath);
  const evaluator = options.evaluator ?? createIntelligenceEvaluator(db!, workspacePath);

  const evaluated: ClarifyEvaluation[] = [];
  const skipped: ClarifySkippedAction[] = [];

  try {
    for (const workItem of candidates) {
      try {
        evaluated.push({ workItem, verdict: await evaluator(workItem) });
      } catch (error) {
        // One unusable verdict must not abandon the rest of the pass. A skipped
        // Action keeps exactly the state it had.
        if (error instanceof ClarifyVerdictUnusableError) {
          skipped.push({ workItemId: workItem.id, title: workItem.title, reason: error.message });
          continue;
        }
        // An unreachable model is not a bad request — say so plainly rather than
        // letting it surface as an unexpected crash.
        if (error instanceof ClarifyEngineUnavailableError) {
          throw clarifyEngineUnavailable(
            `${error.message} Start the local model, or point Arcadia at a reachable Intelligence service.`
          );
        }
        throw error;
      }
    }
  } finally {
    db?.close();
  }

  const applications = options.apply ? applyEvaluations(workspacePath, evaluated) : [];

  return createSuccess({
    command: "clarify",
    workspace: workspacePath,
    data: {
      applied: Boolean(options.apply),
      evaluated,
      applications,
      skipped
    }
  });
}

function applyEvaluations(workspacePath: string, evaluated: ClarifyEvaluation[]): ClarifyApplication[] {
  const applications: ClarifyApplication[] = [];

  for (const { workItem, verdict } of evaluated) {
    if (verdict.verdict === "clarified") {
      const responsibility = RESPONSIBILITY_FOR_ACTOR[verdict.actor];
      withDatabase(workspacePath, (db) =>
        updateWorkItem(db, workItem.id, {
          nextAction: verdict.nextAction,
          workClassification: responsibility,
          queue: queueForWorkClassification(responsibility),
          clarificationStatus: "clarified",
          clarificationSource: verdict.source,
          confidence: verdict.confidence,
          // The gap and question that blocked it are now answered; leaving them
          // would keep advertising a question that no longer applies.
          gapType: null,
          openQuestion: null
        })
      );

      applications.push({ workItemId: workItem.id, clarificationStatus: "clarified" });
      continue;
    }

    // A question becomes a real Decision — the same one `review open` authors —
    // so it queues alongside everything else waiting on a human. `review open`
    // also moves the Action to question_open, so this does not write it twice.
    const opened = runReviewOpenCommand({
      workspace: workspacePath,
      workId: workItem.id,
      question: verdict.question,
      gapType: verdict.gapType,
      recommendation: recommendationFor(verdict.criteria, verdict.draftAsk, verdict.decomposition),
      confidence: verdict.confidence
    });

    applications.push({
      workItemId: workItem.id,
      clarificationStatus: "question_open",
      decisionId: opened.data.item.id,
      decisionSlug: opened.data.item.slug,
      // Proposed subtasks are reported, never created. Decomposition is a
      // proposal until the operator approves it — see the plan's design
      // decisions — so `clarify` deliberately has no path that writes children.
      proposedSubtasks: verdict.decomposition
    });
  }

  return applications;
}

function recommendationFor(
  criteria: string[] | undefined,
  draftAsk: string | undefined,
  decomposition: string[] | undefined
): string | undefined {
  if (criteria?.length) {
    return `Criteria that matter: ${criteria.join("; ")}`;
  }
  if (draftAsk) {
    return `Draft ask: ${draftAsk}`;
  }
  if (decomposition?.length) {
    return `Proposed subtasks (not created): ${decomposition.join("; ")}`;
  }
  return undefined;
}

export function renderClarifySuccess(response: CommandSuccess<ClarifyCommandData>): string[] {
  const { applied, evaluated, applications, skipped } = response.data;

  if (evaluated.length === 0 && skipped.length === 0) {
    return ["No unclarified Actions."];
  }

  const lines: string[] = [
    applied ? `Clarified ${evaluated.length} Action(s).` : `Preview of ${evaluated.length} Action(s) — nothing written.`
  ];

  for (const { workItem, verdict } of evaluated) {
    lines.push("", `${workItem.title} (${workItem.id})`);

    if (verdict.verdict === "clarified") {
      lines.push(
        `  Verdict: clarified (${verdict.confidence} confidence)`,
        `  Next action: ${verdict.nextAction}`,
        `  Actor: ${verdict.actor} -> ${RESPONSIBILITY_FOR_ACTOR[verdict.actor]}`,
        `  Source: ${verdict.source}`
      );
      continue;
    }

    lines.push(`  Verdict: question open`, `  Gap: ${verdict.gapType}`, `  Question: ${verdict.question}`);

    if (verdict.criteria?.length) {
      lines.push(`  Criteria: ${verdict.criteria.join("; ")}`);
    }
    if (verdict.draftAsk) {
      lines.push(`  Draft ask: ${verdict.draftAsk}`);
    }
    if (verdict.decomposition?.length) {
      lines.push("  Proposed subtasks (not created — approve to add them):");
      lines.push(...verdict.decomposition.map((subtask) => `    - ${subtask}`));
    }

    const application = applications.find((entry) => entry.workItemId === workItem.id);
    if (application?.decisionSlug) {
      lines.push(`  Decision: ${application.decisionSlug}`);
    }
  }

  for (const entry of skipped) {
    lines.push("", `${entry.title} (${entry.workItemId})`, `  Skipped: ${entry.reason}`);
  }

  if (!applied && evaluated.length > 0) {
    lines.push("", "Re-run with --apply to write these results.");
  }

  return lines;
}
