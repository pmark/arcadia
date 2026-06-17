import type { ArcadiaCli } from "../arcadia/cli.js";
import {
  formatRequiresReview,
  formatRequiresReviewDecision,
  formatRequiresReviewExecutionDecision,
  formatRequiresReviewShow
} from "../formatters/requiresReviewFormatter.js";

export async function requiresReviewCommand(cli: ArcadiaCli): Promise<string> {
  const response = await cli.review();
  return formatRequiresReview(response.data.items);
}

export async function requiresReviewShowCommand(cli: ArcadiaCli, id: string): Promise<string> {
  const response = await cli.reviewShow(id);
  return formatRequiresReviewShow(response.data.item);
}

export async function requiresReviewApproveCommand(cli: ArcadiaCli, id: string): Promise<string> {
  const response = await cli.reviewApproveWithExecute(id);
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
