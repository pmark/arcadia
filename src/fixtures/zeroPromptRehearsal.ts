import { existsSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { prepareBuildPacketForAcceptedPlan } from "../commands/work.js";
import {
  createReviewItem,
  getProjectBySlug,
  getProjectMetadata,
  getWorkItemByDocRef,
  listCodexInvocationsForWorkItem,
  updateReviewItemStatus
} from "../db/repositories.js";
import type { CodexInvocation, WorkItemSummary } from "../domain/types.js";
import { packetSha256 } from "../execution/planningAuthorization.js";
import { findPromotionDecisionOrProblem } from "../sessions/launchPreview.js";

/**
 * The Zero Prompt Rehearsal fixture Project
 * (`docs/reports/prove-zero-prompt-production-loop-runbook.md`) exists to
 * rehearse the managed-production loop end to end, not to exercise planning.
 * Its two Actions are already fully specified in its plan document — write
 * one line to a marker file, then confirm it — so routing them through a
 * Codex planning packet and a review pass before the guarded launch path can
 * even see them adds a manual step the rehearsal exists to prove is
 * unnecessary (Issue #460).
 *
 * This module creates their build packets directly, through the exact same
 * accepted-plan promotion path (`prepareBuildPacketForAcceptedPlan`) every
 * other Action's build packet goes through once a planning Artifact is
 * accepted — it just supplies that acceptance itself, recorded as a fixture
 * Decision, instead of waiting on a Codex planning Run to produce one. The
 * rendered packet content still comes from the Action's own declared next
 * action, expected artifact, and acceptance criteria (`createCodexPacket` in
 * `src/codex/packets.ts`), the same deterministic rendering every build
 * packet uses — nothing here fabricates placeholder packet content or calls
 * a model.
 *
 * Scope: this seeds packets only for the two named Actions of this one
 * fixture Project, by slug and by Action id. It never runs for any other
 * Project and never changes the general dispatch/planning routing in
 * `src/execution/skills.ts`, so every other Action's Codex planning
 * requirement is unaffected.
 */
export const ZERO_PROMPT_REHEARSAL_PROJECT_SLUG = "zero-prompt-rehearsal";
export const ZERO_PROMPT_REHEARSAL_PLAN_SLUG = "zero-prompt-rehearsal-bootstrap";
export const ZERO_PROMPT_REHEARSAL_ACTION_IDS = ["write-rehearsal-marker", "confirm-rehearsal-marker"] as const;

export interface ZeroPromptRehearsalPacketResult {
  actionId: string;
  invocationId: string;
  reused: boolean;
}

/**
 * Idempotent: an Action that already has a `packet_created` build invocation
 * is left untouched and reported as reused rather than re-prepared.
 */
export function seedZeroPromptRehearsalBuildPackets(
  db: Database.Database,
  workspacePath: string
): ZeroPromptRehearsalPacketResult[] {
  const project = getProjectBySlug(db, ZERO_PROMPT_REHEARSAL_PROJECT_SLUG);
  if (!project) {
    throw validationError(
      `Project "${ZERO_PROMPT_REHEARSAL_PROJECT_SLUG}" was not found; sync its docs before seeding build packets.`,
      { projectSlug: ZERO_PROMPT_REHEARSAL_PROJECT_SLUG }
    );
  }

  return ZERO_PROMPT_REHEARSAL_ACTION_IDS.map((actionId) => seedOne(db, workspacePath, project.id, actionId));
}

function seedOne(
  db: Database.Database,
  workspacePath: string,
  projectId: string,
  actionId: string
): ZeroPromptRehearsalPacketResult {
  const docRef = `plan/${ZERO_PROMPT_REHEARSAL_PLAN_SLUG}#${actionId}`;
  const workItem = getWorkItemByDocRef(db, docRef);
  if (!workItem || workItem.project_id !== projectId) {
    throw validationError(
      `Action "${docRef}" was not found in Project "${ZERO_PROMPT_REHEARSAL_PROJECT_SLUG}".`,
      { actionDocRef: docRef }
    );
  }

  const existing = existingBuildInvocation(db, workItem);
  if (existing && hasApprovedPromotion(db, workspacePath, projectId, workItem, existing)) {
    return { actionId, invocationId: existing.id, reused: true };
  }

  const decision = createReviewItem(db, {
    workItemId: workItem.id,
    projectId: workItem.project_id,
    decisionNeeded: `Accept "${workItem.title}" as a fixture Action needing no Codex planning pass.`,
    recommendation:
      "This Zero Prompt Rehearsal Action is already fully specified by its plan document (a one-line file " +
      "write or confirmation); accepting it directly produces its immutable build packet from that declared " +
      "next action and acceptance criteria, the same rendering every build packet uses, with no planning Run " +
      "or model call.",
    sourceInput: workItem.raw_input,
    proposedAction: `Prepare the immutable build packet for "${workItem.title}" directly from its declared Action.`,
    resolvedIntent: "CodexPlanningArtifactAcceptance",
    confidenceLabel: "high",
    confidence: 1,
    missingFields: [],
    context: {
      zeroPromptRehearsalFixtureAcceptance: true,
      actionId,
      note: "Fixture Action pre-cleared for build; no planning Artifact exists because none was needed."
    }
  });

  const prepared = prepareBuildPacketForAcceptedPlan(db, workspacePath, workItem, decision.id);
  updateReviewItemStatus(db, decision.id, {
    status: "approved",
    decisionNote: "Fixture Action accepted without a planning pass; its declared Action fully specifies the work."
  });

  return { actionId, invocationId: prepared.invocation.id, reused: false };
}

function existingBuildInvocation(db: Database.Database, workItem: WorkItemSummary): CodexInvocation | null {
  return (
    listCodexInvocationsForWorkItem(db, workItem.id)
      .filter((candidate) => candidate.purpose === "build" && candidate.status === "packet_created")
      .at(-1) ?? null
  );
}

/**
 * The supported managed-build path can create a `packet_created` invocation
 * before its promotion Decision is resolved, so a `packet_created` row alone
 * is not proof the guarded launch path will accept it: `buildLaunchPreview`
 * separately requires an *approved* Decision whose recorded `planningPromotion`
 * still matches the packet on disk (`findPromotionDecisionOrProblem` in
 * `src/sessions/launchPreview.ts`). Run that same check here before reusing an
 * existing invocation, so this seeder never reports `reused: true` for a
 * packet that launch would actually refuse.
 */
function hasApprovedPromotion(
  db: Database.Database,
  workspacePath: string,
  projectId: string,
  workItem: WorkItemSummary,
  invocation: CodexInvocation
): boolean {
  const packetPath = path.join(workspacePath, invocation.prompt_path);
  if (!existsSync(packetPath)) return false;
  const repoPath = getProjectMetadata(db, projectId)?.repo_path?.trim() ?? "";
  const actionDocRef = workItem.doc_ref?.trim() ?? "";
  const promotion = findPromotionDecisionOrProblem(db, {
    projectId,
    invocationId: invocation.id,
    actionId: actionDocRef.split("#").at(-1) ?? workItem.id,
    actionDocRef,
    repoRoot: repoPath,
    packetPath: invocation.prompt_path,
    packetSha256: packetSha256(packetPath),
    providerProfile: invocation.agent_profile
  });
  return promotion.problem === null;
}
