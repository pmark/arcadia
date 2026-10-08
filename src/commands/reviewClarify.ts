import { normalizeError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { renderClarifyData, runClarifyCommand, type ClarifyCommandData, type ClarifyCommandOptions } from "./clarify.js";
import {
  ACTION_CLARIFICATION_INTENT,
  renderReviewDecisionSuccess,
  renderReviewResolveReplySuccess,
  runReviewApproveCommand,
  runReviewResolveReplyCommand,
  type RequiresReviewPacket,
  type ReviewDecisionCommandData,
  type ReviewDecisionCommandOptions,
  type ReviewResolveReplyCommandData,
  type ReviewResolveReplyCommandOptions
} from "./review.js";

/**
 * `review approve <id> --answer <text> --clarify` and
 * `review resolve-reply <reply> --id <id> --clarify`.
 *
 * Answering an ActionClarification returns the Action to `unclarified` and
 * leaves re-clarifying explicit. This opt-in flag runs that step once, right
 * after the answer is durable: `clarify --work <id> --apply`.
 *
 * It is a wrapper, not a change to `runReviewApproveCommand` or
 * `runReviewResolveReplyCommand`, so the Discord and dashboard paths (which
 * re-clarify themselves) call exactly the code they always did and nothing runs
 * twice. Without the flag nothing here runs at all.
 */

export interface ReviewClarifyOutcome {
  /** `ran`: clarify --apply ran once. `skipped`: nothing to re-clarify. `failed`: the answer is recorded but clarify could not finish. */
  status: "ran" | "skipped" | "failed";
  workItemId: string | null;
  reason?: string;
  /** The re-run command, when `status` is `failed`. */
  remedy?: string;
  clarify?: ClarifyCommandData;
}

export type ReviewDecisionWithClarify = ReviewDecisionCommandData & { clarification?: ReviewClarifyOutcome };
export type ReviewResolveReplyWithClarify = ReviewResolveReplyCommandData & { clarification?: ReviewClarifyOutcome };

export interface ReviewClarifyHooks {
  /** Injectable for tests. */
  clarify?: Pick<ClarifyCommandOptions, "evaluator" | "grader">;
}

/**
 * Re-clarify the Action behind an answered clarification Decision, once.
 *
 * Only a clarification Decision that is now approved and names its Action is
 * re-clarified; any other item (a reject, a defer, a feedback reply, a Decision
 * that is not a clarification) reports `skipped` and runs nothing. A clarify
 * failure never undoes the answer, which is already durable.
 */
async function clarifyAnsweredItem(
  workspace: string,
  item: RequiresReviewPacket,
  answered: boolean,
  hooks: ReviewClarifyHooks
): Promise<ReviewClarifyOutcome> {
  const workItemId = item.workItemId ?? item.actionId;
  if (!answered || item.resolvedIntent !== ACTION_CLARIFICATION_INTENT) {
    return { status: "skipped", workItemId: workItemId ?? null, reason: "--clarify applies only to an answered clarification Decision." };
  }
  if (!workItemId) {
    return { status: "skipped", workItemId: null, reason: "The clarification names no Action to clarify." };
  }

  try {
    const response = await runClarifyCommand({ workspace, workId: workItemId, apply: true, ...hooks.clarify });
    return { status: "ran", workItemId, clarify: response.data };
  } catch (error) {
    const failure = normalizeError(error);
    return {
      status: "failed",
      workItemId,
      reason: `${failure.code}: ${failure.message}`,
      remedy: `arcadia clarify --work ${workItemId} --apply`
    };
  }
}

export async function runReviewApproveWithClarify(
  options: ReviewDecisionCommandOptions & { clarify?: boolean },
  hooks: ReviewClarifyHooks = {}
): Promise<CommandSuccess<ReviewDecisionWithClarify>> {
  const { clarify, ...approveOptions } = options;
  const response = runReviewApproveCommand(approveOptions);
  if (!clarify) {
    return response;
  }
  const clarification = await clarifyAnsweredItem(
    options.workspace,
    response.data.item,
    response.data.result.status === "approved",
    hooks
  );
  return { ...response, data: { ...response.data, clarification } };
}

export async function runReviewResolveReplyWithClarify(
  options: ReviewResolveReplyCommandOptions & { clarify?: boolean },
  hooks: ReviewClarifyHooks = {}
): Promise<CommandSuccess<ReviewResolveReplyWithClarify>> {
  const { clarify, ...replyOptions } = options;
  const response = runReviewResolveReplyCommand(replyOptions);
  if (!clarify) {
    return response;
  }
  const clarification = await clarifyAnsweredItem(
    options.workspace,
    response.data.item,
    response.data.action === "approved",
    hooks
  );
  return { ...response, data: { ...response.data, clarification } };
}

function renderClarification(clarification: ReviewClarifyOutcome | undefined): string[] {
  if (!clarification) {
    return [];
  }
  if (clarification.status === "ran" && clarification.clarify) {
    return ["", "Re-clarified the Action once:", ...renderClarifyData(clarification.clarify)];
  }
  if (clarification.status === "failed") {
    return ["", `Answer recorded, but clarifying did not finish: ${clarification.reason}`, `Re-run: ${clarification.remedy}`];
  }
  return ["", `Clarify not run: ${clarification.reason}`];
}

export function renderReviewApproveWithClarifySuccess(response: CommandSuccess<ReviewDecisionWithClarify>): string[] {
  return [...renderReviewDecisionSuccess(response), ...renderClarification(response.data.clarification)];
}

export function renderReviewResolveReplyWithClarifySuccess(response: CommandSuccess<ReviewResolveReplyWithClarify>): string[] {
  return [...renderReviewResolveReplySuccess(response), ...renderClarification(response.data.clarification)];
}
