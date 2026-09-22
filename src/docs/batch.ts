import path from "node:path";
import { resolveReadySet, type DispatchBlocker, type ReadySetCandidate, type ReadySetGate } from "./dispatch.js";
import type { TokenImpact } from "./types.js";

/**
 * The current push: what Arcadia would work through before it needs the
 * operator again.
 *
 * A thin wrapper over `resolveReadySet` — the same dependency-clear,
 * gate-free ready set — adding the two things an operator actually needs from
 * it: which Actions can run *at the same time* (lanes, one per repository),
 * and where the run of unattended work stops (the boundary). Documents only:
 * no database, no model call, and no state of its own.
 *
 * The batch is a projection of governed documents, recomputed on every read.
 * Nothing caches it, because a stale batch label is worse than none: the
 * boundary moves the moment a Decision is answered or an Action completes.
 */

/** What one `token_impact` tier is worth when a lane is added up. */
export const TOKEN_TIER_POINTS: Record<TokenImpact, number> = {
  none: 0,
  small: 1,
  medium: 2,
  large: 3,
  xlarge: 4
};

/** One repository whose walk contributes to the push. */
export interface BatchProjectInput {
  repositoryRoot: string;
  /** The Project in that repository. Omitted only for a single-Project repo. */
  projectSlug?: string;
}

/** A lane's token exposure: the tiers in play and what they add up to. */
export interface BatchTokenRollup {
  /** Sum of `TOKEN_TIER_POINTS` over the Actions in scope. */
  points: number;
  /** The distinct tiers behind those points, in first-seen order. */
  tiers: TokenImpact[];
}

export interface BatchActionRef {
  actionId: string;
  title: string;
  projectSlug: string;
}

export interface BatchAction extends BatchActionRef {
  projectName: string | null;
  planSlug: string;
  planPath: string;
  tokenImpact: TokenImpact | null;
  tokenPoints: number;
  /** 1-based position inside this lane's walk. */
  position: number;
}

/**
 * Why the walk stopped. The first four are the operator gates the Action
 * manifests; the last two are everything else that keeps a dependency-clear
 * Action from starting — an unmet prerequisite, or a responsibility no coding
 * agent may take.
 */
export type BatchStopKind = ReadySetGate | "dependency" | "unavailable";

export interface BatchStop {
  kind: BatchStopKind;
  actionId: string;
  title: string;
  projectSlug: string;
  projectName: string | null;
  planPath: string;
  /** Set for a Decision gate: the Decision the operator has to answer. */
  decisionId: string | null;
  /** One sentence naming what the operator must do to move the boundary. */
  prompt: string;
}

export interface BatchLane {
  /** Stable lane key: the repository root, or the project slug when it has none. */
  laneId: string;
  /** Short display name: the repository directory, or the project slug. */
  laneLabel: string;
  repositoryRoot: string | null;
  projectSlugs: string[];
  /**
   * True when the lane holds more than one Action. Same-repository Actions
   * cannot run concurrently under the production policy, so the lane is
   * ordered work — "sequence advised" — even though a different lane may run
   * beside it.
   */
  sequenceAdvised: boolean;
  token: BatchTokenRollup;
  actions: BatchAction[];
  /** Every Action the walk reached that cannot start, up to and including the
   *  boundary, in walk order. Nothing here is silently dropped. */
  stops: BatchStop[];
  /**
   * The first operator gate on the walk: where the unattended run has to ask.
   * Null when the plan has no gate left in front of it.
   */
  boundary: BatchStop | null;
  /** Named, not expanded: the lane's Actions after the boundary. */
  nextPush: BatchActionRef[];
}

export interface BatchResolution {
  /** Lanes in first-seen order: Project order, then declaration order inside it. */
  lanes: BatchLane[];
  /** Every lane's exposure added up. */
  token: BatchTokenRollup;
  /** Projects whose active plan could not be resolved; they contribute no lane. */
  blockers: DispatchBlocker[];
}

/**
 * Where one Action sits in the push, for a surface that labels cards rather
 * than rendering the lanes themselves.
 */
export type BatchSlot = "this_push" | "this_push_sequence" | "next_push" | "not_queued" | BatchStopKind;

/**
 * Compute the current push across the given repositories.
 *
 * Each Project is walked independently, in one order: `current_action` first,
 * then the plan's declaration order, wrapping once so a pointer declared at
 * the end of the document still leads a push that covers the plan. Rotating
 * rather than re-sorting is deliberate — the document's own order is the only
 * ordering it asserts, and a set of ready Actions has no other.
 *
 * The batch is every ready Action on that walk: the same dependency-clear,
 * gate-free set `resolveReadySet` reports, which is what can actually be
 * worked now — wherever in the document each one happens to be declared. The
 * walk then continues past them, collecting each Action that cannot start,
 * until it reaches the first of the four operator gates; that gate is the
 * boundary, and the non-ready remainder after it is named but not expanded.
 * A Project whose pointer is stuck therefore cannot hide a different
 * Project's ready work, and a blocked Action sitting between two ready ones
 * is reported rather than dropped.
 *
 * The boundary is where *this push* ends, not a lock: the production policy
 * still lets independent eligible work proceed past an operator stop, which is
 * exactly why the ready Actions after it are still shown in the push.
 *
 * Lanes then group the resulting batch Actions by repository, because that is
 * the boundary the production policy actually enforces: one repository, one
 * lease.
 */
export function resolveBatch(inputs: BatchProjectInput[]): BatchResolution {
  const blockers: DispatchBlocker[] = [];
  const lanes = new Map<string, BatchLane>();
  const laneOrder: string[] = [];
  const token: BatchTokenRollup = { points: 0, tiers: [] };

  for (const input of inputs) {
    const readySet = resolveReadySet(input.repositoryRoot, input.projectSlug);
    if (readySet.blockers.length > 0) blockers.push(...readySet.blockers);
    const planSlug = readySet.planSlug;
    const planPath = readySet.planPath;
    if (!planSlug || !planPath || readySet.candidates.length === 0) continue;

    const projectSlug = readySet.projectSlug ?? input.projectSlug ?? "(unknown)";
    const projectName = readySet.projectName;
    const repositoryRoot = path.resolve(input.repositoryRoot);
    const planTokenImpact = readySet.planTokenImpact;
    const planTokenPoints = planTokenImpact ? TOKEN_TIER_POINTS[planTokenImpact] : 0;

    const order = rotateToCurrent(readySet.currentAction, readySet.candidates);

    let lane = lanes.get(repositoryRoot);
    if (!lane) {
      lane = {
        laneId: repositoryRoot,
        laneLabel: path.basename(repositoryRoot) || projectSlug,
        repositoryRoot,
        projectSlugs: [],
        sequenceAdvised: false,
        token: { points: 0, tiers: [] },
        actions: [],
        stops: [],
        boundary: null,
        nextPush: []
      };
      lanes.set(repositoryRoot, lane);
      laneOrder.push(repositoryRoot);
    }
    if (!lane.projectSlugs.includes(projectSlug)) lane.projectSlugs.push(projectSlug);

    // Walk the rotated order once. Every ready Action joins the batch,
    // wherever it is declared — the batch is the ready set, not a prefix of
    // the document. A non-ready Action that is *not* one of the four gates (an
    // unmet dependency, or a responsibility no coding agent may take) is
    // reported as a stop and the walk continues, because only a gate ends the
    // push. The first gate is the boundary; the non-ready remainder after it
    // is named and left unexpanded.
    const batch: ReadySetCandidate[] = [];
    let boundaryIndex = -1;
    for (let index = 0; index < order.length; index += 1) {
      const candidate = order[index];
      if (candidate.ready) {
        batch.push(candidate);
        continue;
      }
      if (boundaryIndex >= 0) continue;
      const stop = stopFor(candidate, projectSlug, projectName, planPath);
      lane.stops.push(stop);
      if (isGateKind(stop.kind)) {
        boundaryIndex = index;
        // The lane's boundary is the first gate any of its Projects reaches,
        // not the last: a second Project sharing the repository must not
        // overwrite where the push already stopped.
        lane.boundary ??= stop;
      }
    }

    // Positions are per lane and assigned after grouping, so a Project that
    // joins an existing lane continues that lane's numbering rather than
    // restarting it at 1.
    for (const candidate of batch) {
      lane.actions.push({
        actionId: candidate.actionId,
        title: candidate.title,
        projectSlug,
        projectName,
        planSlug,
        planPath,
        tokenImpact: planTokenImpact,
        tokenPoints: planTokenPoints,
        position: lane.actions.length + 1
      });
    }

    if (boundaryIndex >= 0) {
      for (const candidate of order.slice(boundaryIndex + 1)) {
        if (candidate.ready) continue;
        lane.nextPush.push({ actionId: candidate.actionId, title: candidate.title, projectSlug });
      }
    }
  }

  const resolvedLanes = laneOrder.map((id) => lanes.get(id)!);
  for (const lane of resolvedLanes) {
    lane.sequenceAdvised = lane.actions.length > 1;
    lane.token = rollup(lane.actions.map((action) => action.tokenImpact));
    token.points += lane.token.points;
    for (const tier of lane.token.tiers) if (!token.tiers.includes(tier)) token.tiers.push(tier);
  }

  return { lanes: resolvedLanes, token, blockers };
}

/**
 * Where one Action sits in the push, or `not_queued` when the walk never
 * reached it.
 *
 * Matched on Project *and* Action id: a lane is a repository, and a repository
 * can hold more than one Project, so an action id alone can name two different
 * Actions.
 */
export function batchSlotFor(resolution: BatchResolution, projectSlug: string, actionId: string): BatchSlot {
  const matches = (candidate: BatchActionRef) =>
    candidate.projectSlug === projectSlug && candidate.actionId === actionId;
  for (const lane of resolution.lanes) {
    if (!lane.projectSlugs.includes(projectSlug)) continue;
    if (lane.actions.some(matches)) {
      return lane.sequenceAdvised ? "this_push_sequence" : "this_push";
    }
    const stop = lane.stops.find(matches);
    if (stop) return stop.kind;
    if (lane.nextPush.some(matches)) return "next_push";
  }
  return "not_queued";
}

function isGateKind(kind: BatchStopKind): kind is ReadySetGate {
  return kind === "decision" || kind === "deferred" || kind === "question_open" || kind === "capacity_proof_run";
}

/**
 * The plan's Actions as one walk: the pointer first, then declaration order,
 * wrapping once. With no pointer (or a dangling one) the first ready Action
 * leads, so the walk still starts where work would; failing that, the head of
 * the plan, so a fully blocked Project still reports what is holding it.
 */
function rotateToCurrent(currentAction: string | null, candidates: ReadySetCandidate[]): ReadySetCandidate[] {
  let start = -1;
  if (currentAction) start = candidates.findIndex((candidate) => candidate.actionId === currentAction);
  if (start < 0) start = candidates.findIndex((candidate) => candidate.ready);
  if (start <= 0) return [...candidates];
  return [...candidates.slice(start), ...candidates.slice(0, start)];
}

function stopFor(
  candidate: ReadySetCandidate,
  projectSlug: string,
  projectName: string | null,
  planPath: string
): BatchStop {
  const decisionId = candidate.deferringDecisionId ?? candidate.requiredDecisionId ?? null;
  return {
    kind: stopKindFor(candidate),
    actionId: candidate.actionId,
    title: candidate.title,
    projectSlug,
    projectName,
    planPath,
    decisionId,
    prompt: stopPromptFor(candidate, decisionId)
  };
}

function stopKindFor(candidate: ReadySetCandidate): BatchStopKind {
  if (candidate.gate) return candidate.gate;
  if (candidate.blockers.some((blocker) => blocker.field.includes("depends_on"))) return "dependency";
  return "unavailable";
}

function stopPromptFor(candidate: ReadySetCandidate, decisionId: string | null): string {
  switch (stopKindFor(candidate)) {
    case "decision":
      return decisionId
        ? `Answer Decision ${decisionId} — it gates "${candidate.actionId}", and the push cannot continue past it.`
        : `Answer the Decision gating "${candidate.actionId}" before the push can continue.`;
    case "deferred":
      return `"${candidate.actionId}" is deferred${decisionId ? ` by Decision ${decisionId}` : ""}; it revives on its named condition.`;
    case "question_open":
      return candidate.operatorQuestion?.trim()
        ? `${candidate.actionId}: ${candidate.operatorQuestion.trim()}`
        : `Answer the open clarification question on "${candidate.actionId}".`;
    case "capacity_proof_run":
      return `"${candidate.actionId}" requires the operator — a coding agent must not run it, and it spends provider capacity.`;
    case "dependency":
    case "unavailable":
      return candidate.blockers[0]?.message ?? `"${candidate.actionId}" is not ready.`;
  }
}

function rollup(tiers: Array<TokenImpact | null>): BatchTokenRollup {
  const present: TokenImpact[] = [];
  let points = 0;
  for (const tier of tiers) {
    if (!tier) continue;
    points += TOKEN_TIER_POINTS[tier];
    if (!present.includes(tier)) present.push(tier);
  }
  return { points, tiers: present };
}
