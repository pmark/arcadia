import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getWorkItem, listActionableReviewItems } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";
import { computeNowBrief } from "../northStar/compute.js";
import { loadNorthStar, NorthStarParseError } from "../northStar/document.js";
import { computePathBrief } from "../northStar/path.js";
import {
  ACTION_CLARIFICATION_INTENT,
  reviewPacketForReviewItem,
  runReviewApproveCommand,
  runReviewOpenCommand,
  type RequiresReviewPacket
} from "./review.js";

/**
 * Full context for one blocked Action's question — what the Path screen's
 * gap links to.
 *
 * Everything here is read from records that already exist; this adds no new
 * storage. It exists because the Path screen previously stated only that an
 * Action was blocked, with nowhere to go to actually unblock it, and an
 * operator who answered a *different*, unrelated Decision elsewhere had no
 * way to see that it left this one untouched.
 */
export interface WorkQuestionContextData {
  workItem: {
    id: string;
    title: string;
    project: string | null;
    docRef: string | null;
    status: string;
    clarificationStatus: string | null;
    gapType: string | null;
    openQuestion: string | null;
    expectedArtifact: string | null;
  };
  /** False when there is nothing here for an answer to resolve. */
  resolvable: boolean;
  reviewItem: RequiresReviewPacket | null;
  blockedGate: { gateId: string; gateTitle: string; remaining: number } | null;
}

export function runWorkShowQuestionCommand(options: {
  workspace: string;
  workId: string;
}): CommandSuccess<WorkQuestionContextData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const data = withDatabase(workspacePath, (db) => {
    const workItem = getWorkItem(db, options.workId);
    if (!workItem) {
      throw validationError("Action was not found.", { workId: options.workId });
    }

    const reviewItem =
      listActionableReviewItems(db).find(
        (item) => item.work_item_id === workItem.id && item.resolved_intent === ACTION_CLARIFICATION_INTENT
      ) ?? null;

    let blockedGate: WorkQuestionContextData["blockedGate"] = null;
    let northStar = null;
    try {
      northStar = loadNorthStar(workspacePath);
    } catch (error) {
      if (!(error instanceof NorthStarParseError)) throw error;
    }
    if (northStar) {
      const brief = computeNowBrief(db, northStar, {});
      const path = computePathBrief(db, northStar, brief.gates);
      for (const leg of path.legs) {
        const hit = leg.nodes.some((node) => node.kind === "action" && node.workItemId === workItem.id);
        if (hit) {
          blockedGate = { gateId: leg.gateId, gateTitle: leg.gateTitle, remaining: leg.remaining };
          break;
        }
      }
    }

    return {
      workItem: {
        id: workItem.id,
        title: workItem.title,
        project: workItem.project_name,
        docRef: workItem.doc_ref,
        status: workItem.status,
        clarificationStatus: workItem.clarification_status,
        gapType: workItem.gap_type,
        openQuestion: workItem.open_question,
        expectedArtifact: workItem.expected_artifact
      },
      resolvable: workItem.clarification_status === "question_open" && Boolean(workItem.open_question?.trim()),
      reviewItem: reviewItem ? reviewPacketForReviewItem(reviewItem) : null,
      blockedGate
    };
  });

  return createSuccess({ command: "work.show-question", workspace: workspacePath, data });
}

export interface WorkResolveQuestionData {
  workItem: WorkItemSummary;
  reviewItem: RequiresReviewPacket;
}

/**
 * Answer an Action's blocking question from wherever it was found — Path,
 * `/review`, or the terminal — even when nothing ever opened a Decision for
 * it.
 *
 * Every *other* way an Action reaches `question_open` (the local clarify
 * engine, `review open` itself) already opens one. `docs sync` ingesting a
 * plan-declared `clarification: question_open` was the one way in that
 * didn't, until the sibling fix in `docs/sync.ts`. This is the belt-and-
 * suspenders half: an Action can still reach here with no Decision on record
 * — synced before that fix ran, or blocked by some future path this doesn't
 * anticipate — and answering it must not depend on knowing to run
 * `review open` by hand first.
 */
export function runWorkResolveQuestionCommand(options: {
  workspace: string;
  workId: string;
  answer: string;
}): CommandSuccess<WorkResolveQuestionData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const answer = options.answer.trim();
  if (!answer) {
    throw validationError("An answer is required.", { workId: options.workId });
  }

  const workItem = withDatabase(workspacePath, (db) => getWorkItem(db, options.workId));
  if (!workItem) {
    throw validationError("Action was not found.", { workId: options.workId });
  }
  if (workItem.clarification_status !== "question_open" || !workItem.open_question?.trim()) {
    throw validationError("Nothing is waiting on an answer for this Action.", {
      workId: options.workId,
      clarificationStatus: workItem.clarification_status
    });
  }

  const existing = withDatabase(workspacePath, (db) =>
    listActionableReviewItems(db).find(
      (item) => item.work_item_id === workItem.id && item.resolved_intent === ACTION_CLARIFICATION_INTENT
    )
  );

  const reviewItemId = existing
    ? existing.id
    : runReviewOpenCommand({
        workspace: workspacePath,
        workId: workItem.id,
        question: workItem.open_question,
        gapType: workItem.gap_type ?? undefined,
        confidence: workItem.confidence ?? undefined
      }).data.item.id;

  const approved = runReviewApproveCommand({ workspace: workspacePath, id: reviewItemId, answer });
  const updatedWorkItem = withDatabase(workspacePath, (db) => getWorkItem(db, workItem.id));
  if (!updatedWorkItem) {
    throw validationError("Action was not found after recording the answer.", { workId: workItem.id });
  }

  return createSuccess({
    command: "work.resolve-question",
    workspace: workspacePath,
    data: { workItem: updatedWorkItem, reviewItem: approved.data.item }
  });
}

export function renderWorkShowQuestionSuccess(response: CommandSuccess<WorkQuestionContextData>): string[] {
  const data = response.data;
  const lines = [data.workItem.title, `Project: ${data.workItem.project ?? "unknown"}`];
  if (data.blockedGate) {
    lines.push(`Blocks: ${data.blockedGate.gateTitle} (${data.blockedGate.remaining} step(s) left there)`);
  }
  lines.push("", data.resolvable ? `Question: ${data.workItem.openQuestion}` : "Nothing here is waiting on an answer.");
  if (data.reviewItem) {
    lines.push(`Decision: ${data.reviewItem.slug}`);
  }
  return lines;
}

export function renderWorkResolveQuestionSuccess(response: CommandSuccess<WorkResolveQuestionData>): string[] {
  return [
    `Answer recorded for ${response.data.reviewItem.slug}.`,
    `Action ${response.data.workItem.id} is now ${response.data.workItem.clarification_status}.`,
    response.data.workItem.clarification_status === "unclarified"
      ? "Run `arcadia clarify --work " + response.data.workItem.id + " --apply` to continue it."
      : ""
  ].filter(Boolean);
}
