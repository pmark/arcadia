import type { ArcadiaCli } from "../arcadia/cli.js";
import type { BotConfig } from "../config.js";
import {
  formatRequiresReview,
  formatRequiresReviewDecision,
  formatRequiresReviewExecutionDecision,
  formatRequiresReviewShow
} from "../formatters/requiresReviewFormatter.js";
import { discordSubmissionStatePath, recordDiscordSubmission } from "../notifications/state.js";

export async function requiresReviewCommand(cli: ArcadiaCli): Promise<string> {
  const response = await cli.review();
  return formatRequiresReview(response.data.items);
}

export async function requiresReviewShowCommand(cli: ArcadiaCli, id: string): Promise<string> {
  const response = await cli.reviewShow(id);
  return formatRequiresReviewShow(response.data.item);
}

export async function requiresReviewApproveCommand(cli: ArcadiaCli, id: string, config: BotConfig): Promise<string> {
  const response = await cli.reviewApproveWithExecute(id);
  const runId = response.data.run?.id ?? null;
  if (runId) {
    await recordDiscordSubmission(discordSubmissionStatePath(config.arcadiaWorkspace), {
      askId: `review-approve:${id}`,
      workItemId: null,
      runId
    });
  }
  return formatRequiresReviewExecutionDecision(response.data);
}

export async function requiresReviewRejectCommand(cli: ArcadiaCli, id: string): Promise<string> {
  const response = await cli.reviewReject(id);
  return formatRequiresReviewDecision(response.data);
}

export async function requiresReviewDeferCommand(cli: ArcadiaCli, id: string): Promise<string> {
  const response = await cli.reviewDefer(id);
  return formatRequiresReviewDecision(response.data);
}
