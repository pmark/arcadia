import type Database from "better-sqlite3";
import { getCodexInvocation, listCodexInvocationsForWorkItem, listReviewItems } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";

/**
 * The preparation state that sits before a Session may be launched. This is a
 * projection over the existing planner, Decisions, and build packet records;
 * it intentionally creates neither another packet nor another approval path.
 */
export type PacketLifecycleState =
  | { kind: "planning_required"; remedy: string }
  | { kind: "planning_approval_pending"; decisionId: string; remedy: string }
  | { kind: "planning_in_progress"; decisionId: string; remedy: string }
  | { kind: "build_packet_ready"; invocationId: string; remedy: string }
  | { kind: "stale_packet"; invocationId: string; remedy: string };

export function resolvePacketLifecycle(db: Database.Database, workItem: WorkItemSummary): PacketLifecycleState {
  const build = listCodexInvocationsForWorkItem(db, workItem.id)
    .filter((candidate) => candidate.purpose === "build" && candidate.status === "packet_created")
    .at(-1);
  if (build) {
    return {
      kind: "build_packet_ready",
      invocationId: build.id,
      remedy: "Preview and launch this immutable build packet after its current authority checks pass."
    };
  }

  const planningDecision = listReviewItems(db, "all")
    .filter((candidate) =>
      candidate.work_item_id === workItem.id &&
      candidate.resolved_intent === "CodexPlanningRunApproval" &&
      (candidate.status === "open" || candidate.status === "deferred" || candidate.status === "approved")
    )
    .at(-1);
  if (planningDecision) {
    const invocation = planningDecision.codex_invocation_id
      ? getCodexInvocation(db, planningDecision.codex_invocation_id)
      : null;
    if (planningDecision.status === "approved" || invocation?.status === "running") {
      return {
        kind: "planning_in_progress",
        decisionId: planningDecision.id,
        remedy: `Wait for planning Decision ${planningDecision.slug ?? planningDecision.id} to produce its Artifact, then accept that Artifact through Review.`
      };
    }
    return {
      kind: "planning_approval_pending",
      decisionId: planningDecision.id,
      remedy: `Resolve planning Decision ${planningDecision.slug ?? planningDecision.id} through Review; that approval authorizes planning only, not implementation.`
    };
  }

  return {
    kind: "planning_required",
    remedy: `Prepare the existing planning packet with arcadia work plan ${workItem.id}.`
  };
}
