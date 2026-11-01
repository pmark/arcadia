import type Database from "better-sqlite3";
import { getCodexInvocation, listCodexInvocationsForWorkItem, listReviewItems } from "../db/repositories.js";
import type { WorkItemSummary } from "../domain/types.js";
import { packetIsForCurrentInput } from "./packetInputRevision.js";

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
  | { kind: "build_packet_approval_pending"; invocationId: string; decisionId: string; remedy: string }
  /**
   * `supersededInput` marks a packet prepared for an earlier Action input (or
   * one that records none): `arcadia work plan` prepares its fresh
   * replacement. Without it the packet's authority is stale for another
   * reason (changed file, binding, approval) that re-planning cannot fix.
   */
  | { kind: "stale_packet"; invocationId: string; remedy: string; supersededInput?: true };

/**
 * True when the Action declares `execution: build` and that declaration is
 * honoured -- exactly the condition under which `planStepsForWorkItem` routes
 * it to `codex_build`, never to a planning run. Such an Action is gated by its
 * build packet and that packet's approval only; planning Decisions and
 * planning Artifacts left over from an earlier route are history, not gates.
 */
export function declaresBuildRoute(workItem: Pick<WorkItemSummary, "execution_route" | "work_classification">): boolean {
  return workItem.execution_route === "build" &&
    (workItem.work_classification === "agent" || workItem.work_classification === "autonomous");
}

export function resolvePacketLifecycle(db: Database.Database, workItem: WorkItemSummary, options: { workspace: string }): PacketLifecycleState {
  const build = listCodexInvocationsForWorkItem(db, workItem.id)
    .filter((candidate) => candidate.purpose === "build" && candidate.status === "packet_created")
    .at(-1);
  if (build) {
    if (!packetIsForCurrentInput(options.workspace, build.prompt_path, workItem)) {
      return {
        kind: "stale_packet",
        invocationId: build.id,
        supersededInput: true,
        remedy: `Build packet ${build.id} was prepared for an earlier input of this Action, or records none; prepare a fresh build packet with arcadia work plan ${workItem.id}. The old packet and its approval stay as history.`
      };
    }
    return {
      kind: "build_packet_ready",
      invocationId: build.id,
      remedy: "Preview and launch this immutable build packet after its current authority checks pass."
    };
  }

  if (declaresBuildRoute(workItem)) {
    return {
      kind: "planning_required",
      remedy: `Prepare the build packet with arcadia work plan ${workItem.id}; this Action declares execution: build, so earlier planning Decisions do not gate it.`
    };
  }

  const planningDecision = listReviewItems(db, "all")
    .filter((candidate) =>
      candidate.work_item_id === workItem.id &&
      candidate.resolved_intent === "CodexPlanningRunApproval" &&
      (candidate.status === "open" || candidate.status === "deferred" || candidate.status === "approved")
    )
    // listReviewItems orders newest first, so the newest matching Decision is
    // the head of the list. `.at(-1)` here selected the OLDEST one, which left
    // the worker waiting forever on a planning Decision that had already been
    // superseded (Issue #404). The build-packet lookup above is the opposite
    // case: listCodexInvocationsForWorkItem orders oldest first, so its
    // `.at(-1)` correctly takes the newest.
    .at(0);
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
