import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createAskFeedback, getAskRequest, listRecentAskFeedback } from "../db/repositories.js";
import type { AskFeedbackDecision } from "../domain/constants.js";
import type { AskFeedback } from "../domain/types.js";

export interface FeedbackRecordCommandOptions {
  workspace: string;
  askRequestId: string;
  decision: AskFeedbackDecision;
  note?: string;
  sourceIngress?: string;
}

export interface FeedbackRecordCommandData {
  feedback: AskFeedback;
  result: {
    status: "recorded";
    summary: string;
  };
}

export function runFeedbackRecordCommand(
  options: FeedbackRecordCommandOptions
): CommandSuccess<FeedbackRecordCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  return withDatabase(workspacePath, (db) => {
    const ask = getAskRequest(db, options.askRequestId);
    if (!ask) {
      throw validationError("Ask request was not found.", { askRequestId: options.askRequestId });
    }

    const feedback = createAskFeedback(db, {
      askRequestId: options.askRequestId,
      decision: options.decision,
      note: options.note ?? null,
      sourceIngress: options.sourceIngress ?? null
    });

    return createSuccess({
      command: "feedback.record",
      workspace: workspacePath,
      data: {
        feedback,
        result: {
          status: "recorded" as const,
          summary: `Recorded thumbs-${feedback.decision} feedback on ask ${options.askRequestId}.`
        }
      }
    });
  });
}

export interface FeedbackListCommandOptions {
  workspace: string;
  limit?: number;
}

export interface FeedbackListCommandData {
  items: AskFeedback[];
  counts: {
    up: number;
    down: number;
  };
}

export function runFeedbackListCommand(
  options: FeedbackListCommandOptions
): CommandSuccess<FeedbackListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const items = withDatabase(workspacePath, (db) => listRecentAskFeedback(db, options.limit ?? 50));
  const counts = {
    up: items.filter((item) => item.decision === "up").length,
    down: items.filter((item) => item.decision === "down").length
  };

  return createSuccess({
    command: "feedback.list",
    workspace: workspacePath,
    data: { items, counts }
  });
}

export function renderFeedbackRecordSuccess(response: CommandSuccess<FeedbackRecordCommandData>): string[] {
  return ["Arcadia Feedback", response.data.result.summary];
}

export function renderFeedbackListSuccess(response: CommandSuccess<FeedbackListCommandData>): string[] {
  const { items, counts } = response.data;
  const lines = ["Arcadia Feedback", `Up: ${counts.up}  Down: ${counts.down}`];
  for (const item of items) {
    lines.push(`${item.created_at}  ${item.decision}  ask ${item.ask_request_id}${item.note ? `  — ${item.note}` : ""}`);
  }
  return lines;
}
