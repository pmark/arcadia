import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { runAgentAskDraftCommand } from "../commands/agentAsk.js";
import { withDatabase } from "../db/connection.js";
import { getProject, getProjectMetadata } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";
import { sha256Hex } from "./grader.js";
import type { ClarifiedVerdict } from "./types.js";

/**
 * The file handoff from a graded Action to a coding agent.
 *
 * A handoff is a checked-in file or an Agent Ask, never chat. When a clarified
 * verdict that the separate grader passed names a coding agent as the actor and
 * the Action came from a captured Ask, `clarify --apply` drafts one strict v1
 * Agent Ask into the Project repository's `.arcadia/asks/` through the existing
 * draft writer. The Ask is a proposal: it appears in `arcadia todo` as a pending
 * proposal and nothing happens until it is settled. Clarify itself writes no
 * Action status, pointer or queue.
 */

export interface HandoffReport {
  requestId: string;
  status: "drafted" | "skipped";
  /** Why nothing was drafted, or what failed. */
  reason?: string;
  /** The drafted file, when `status` is `drafted`. */
  path?: string;
}

/** Only a graded coding-agent Action that came from a captured Ask is handed off. */
export function isHandoffEligible(workItem: WorkItemSummary, verdict: ClarifiedVerdict): boolean {
  return verdict.actor === "coding-agent" && Boolean(workItem.capture_id);
}

/** Stable for the same Action, next action and done-condition, so a re-run replays instead of duplicating. */
export function handoffRequestId(workItemId: string, nextAction: string, doneCondition: string): string {
  return `handoff-${workItemId}-${sha256Hex(nextAction + doneCondition).slice(0, 12)}`;
}

/** The strict v1 Ask as a compact JSON document (valid YAML, like the other checked-in Asks). */
export function buildHandoffAsk(input: {
  requestId: string;
  projectSlug: string;
  workItem: WorkItemSummary;
  verdict: ClarifiedVerdict;
}): string {
  const { requestId, projectSlug, workItem, verdict } = input;
  return `${JSON.stringify({
    agent_ask: "v1",
    request_id: requestId,
    project: projectSlug,
    intent: "action",
    requested_authority: "propose",
    desired_result: verdict.nextAction,
    rationale:
      `Handoff of clarified Action ${workItem.id} (captured as envelope ${workItem.capture_id}) to a coding agent. ` +
      "A separate grader passed the next action and its done-condition. Clarify wrote no Action status, pointer or queue; " +
      "accepting this Ask is the operator's call.",
    acceptance: [verdict.doneCondition]
  })}\n`;
}

/**
 * Draft the handoff Ask for one passing verdict. Never throws for an expected
 * refusal: a Project with no repository path, or a request id that already
 * exists (even one already settled and archived), is reported and skipped.
 */
export function draftHandoffAsk(workspacePath: string, workItem: WorkItemSummary, verdict: ClarifiedVerdict): HandoffReport {
  const requestId = handoffRequestId(workItem.id, verdict.nextAction, verdict.doneCondition);

  const context = withDatabase(workspacePath, (db) => {
    const project = workItem.project_id ? getProject(db, workItem.project_id) : null;
    const repoPath = project ? getProjectMetadata(db, project.id)?.repo_path?.trim() || null : null;
    // A proposal row survives settlement and archiving, so it is the record of
    // "this request id was ever used"; the file check covers a draft written
    // before a workspace could preview it.
    const known = db.prepare("SELECT 1 FROM agent_ask_proposals WHERE request_id = ?").get(requestId) !== undefined;
    return { project, repoPath, known };
  });

  if (!context.project) {
    return { requestId, status: "skipped", reason: "the Action has no Project, so there is no repository to hand off into" };
  }
  if (!context.repoPath) {
    return { requestId, status: "skipped", reason: `Project ${context.project.slug} has no repo_path` };
  }
  if (!existsSync(context.repoPath) || !statSync(context.repoPath).isDirectory()) {
    return { requestId, status: "skipped", reason: `Project ${context.project.slug} repo_path is not a directory: ${context.repoPath}` };
  }
  if (context.known) {
    return { requestId, status: "skipped", reason: `Agent Ask ${requestId} already exists (proposed, settled or archived)` };
  }
  if (existsSync(path.join(context.repoPath, ".arcadia", "asks", `agent-ask-${requestId}.yaml`))) {
    return { requestId, status: "skipped", reason: `Agent Ask ${requestId} already exists as a draft file` };
  }

  try {
    const drafted = runAgentAskDraftCommand({
      request: buildHandoffAsk({ requestId, projectSlug: context.project.slug, workItem, verdict }),
      workspace: workspacePath,
      dir: context.repoPath
    });
    return { requestId, status: "drafted", path: drafted.data.path };
  } catch (error) {
    // The clarification is already recorded; a failed draft must not undo or
    // hide it. Report why and let the operator re-run `clarify --work`.
    return {
      requestId,
      status: "skipped",
      reason: `drafting failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
