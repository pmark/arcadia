import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { existingDirectory } from "../git/worktrees.js";
import {
  declineCodeRabbitFinding,
  waitForCodeRabbitReview,
  type CodeRabbitReviewResult,
  type DeclineFindingResult
} from "../stewardship/codeRabbitReview.js";

export async function runPrCodeReviewCommand(options: { repo: string; pr: string; timeoutMin: string }): Promise<CommandSuccess<CodeRabbitReviewResult>> {
  const pr = Number(options.pr);
  const timeoutMin = Number(options.timeoutMin);
  if (!Number.isInteger(pr) || pr <= 0) throw validationError("PR must be a positive integer.", { pr: options.pr });
  if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) throw validationError("--timeout-min must be a positive number.");
  const data = await waitForCodeRabbitReview({ repo: existingDirectory(options.repo, "repository"), pr, timeoutMin });
  return createSuccess({ command: "pr.codeReview", data });
}

export function renderPrCodeReviewSuccess(response: CommandSuccess<CodeRabbitReviewResult>): string[] {
  const data = response.data;
  const lines = [
    `Verdict: ${data.verdict}${data.approved ? " (approved)" : ""}`,
    `PR #${data.pr} head ${data.head.slice(0, 8)} — fix round ${data.fixRound} of ${data.maxFixRounds}`,
    data.note
  ];
  for (const finding of data.findings) {
    lines.push("", `- ${finding.threadId} ${finding.path}:${finding.line ?? "?"}${finding.outdated ? " (outdated)" : ""}`, `  ${finding.url}`, ...finding.body.split("\n").map((line) => `  ${line}`));
  }
  if (data.outsideDiffFindings && data.prompt) lines.push("", "Findings outside the diff (from CodeRabbit's prompt):", data.prompt);
  return lines;
}

export function runPrDeclineFindingCommand(options: { repo: string; threadId: string; reason: string }): CommandSuccess<DeclineFindingResult> {
  const reason = options.reason.trim();
  if (!reason) throw validationError("A decline needs a reason; it is posted on the thread.");
  const data = declineCodeRabbitFinding(existingDirectory(options.repo, "repository"), options.threadId, reason);
  return createSuccess({ command: "pr.declineFinding", data });
}

export function renderPrDeclineFindingSuccess(response: CommandSuccess<DeclineFindingResult>): string[] {
  const data = response.data;
  return [`Declined ${data.threadId}${data.resolved ? " and resolved it" : " (thread not resolved)"}`, ...(data.replyUrl ? [data.replyUrl] : [])];
}
