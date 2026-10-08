import { existsSync, readdirSync, statSync } from "node:fs";
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
  /** Whether the draft was also previewed into the workspace; `preview_blocked` or `not_available` means no proposal row exists yet. */
  workspaceStatus?: "previewed" | "not_available" | "preview_blocked";
}

function existingHandoffDraft(repoPath: string, prefix: string): string | null {
  try {
    return (
      readdirSync(path.join(repoPath, ".arcadia", "asks")).find(
        (name) => name.startsWith(`agent-ask-${prefix}`) && /\.ya?ml$/.test(name)
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** Only a graded coding-agent Action that came from a captured Ask is handed off. */
export function isHandoffEligible(workItem: WorkItemSummary, verdict: ClarifiedVerdict): boolean {
  return verdict.actor === "coding-agent" && Boolean(workItem.capture_id);
}

/**
 * Work item ids carry an underscore (`work_<hex>`). Request ids stay within
 * `[a-z0-9-]` so the draft file name is one `untrackedDraftAskPaths` recognizes
 * as intake and never counts as dirt in the Project's checkout.
 */
function requestIdSegment(workItemId: string): string {
  return workItemId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Every handoff request id for one Action starts with this, whatever its candidate text. */
export function handoffRequestPrefix(workItemId: string): string {
  return `handoff-${requestIdSegment(workItemId)}-`;
}

/** Stable for the same Action, next action and done-condition, so a re-run replays instead of duplicating. */
export function handoffRequestId(workItemId: string, nextAction: string, doneCondition: string): string {
  return `${handoffRequestPrefix(workItemId)}${sha256Hex(nextAction + doneCondition).slice(0, 12)}`;
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
    // One handoff per Action: the candidate text varies between runs, so any
    // request id with this Action's prefix counts, not just this exact one.
    const prefix = handoffRequestPrefix(workItem.id);
    const known =
      (
        db
          .prepare("SELECT request_id FROM agent_ask_proposals WHERE substr(request_id, 1, ?) = ? LIMIT 1")
          .get(prefix.length, prefix) as { request_id: string } | undefined
      )?.request_id ?? null;
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
    return { requestId, status: "skipped", reason: `Agent Ask ${context.known} already hands off this Action (proposed, settled or archived)` };
  }
  const existingDraft = existingHandoffDraft(context.repoPath, handoffRequestPrefix(workItem.id));
  if (existingDraft) {
    return { requestId, status: "skipped", reason: `Agent Ask draft ${existingDraft} already hands off this Action` };
  }

  try {
    const drafted = runAgentAskDraftCommand({
      request: buildHandoffAsk({ requestId, projectSlug: context.project.slug, workItem, verdict }),
      workspace: workspacePath,
      dir: context.repoPath
    });
    return { requestId, status: "drafted", path: drafted.data.path, workspaceStatus: drafted.data.workspaceStatus };
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
