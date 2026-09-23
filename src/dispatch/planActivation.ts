import { discoverDocs } from "../docs/discover.js";
import { resolveActionReadiness } from "../docs/dispatch.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";

/**
 * One eligible Action the total transition resolver could make current, with
 * the explicit queue position that ranks it (null when it has never been
 * ordered).
 */
export interface PlanActivationAction {
  planSlug: string;
  planPath: string;
  actionId: string;
  actionTitle: string;
  actionKey: string;
  position: number | null;
}

export type PlanActivationStatus = "candidate" | "unordered" | "ambiguous" | "none";

export interface PlanActivationResolution {
  status: PlanActivationStatus;
  /** Operator-facing one-liner naming the move or the reason none is safe. */
  reason: string;
  projectSlug: string;
  /** The Plan PROJECT.md currently points at, when one resolves. */
  activePlan: string | null;
  activePlanStatus: string | null;
  /** The Action that would become current, when the queue determines one. */
  candidate: PlanActivationAction | null;
  /** Every eligible Action, positioned ones first, in queue-then-document order. */
  ranked: PlanActivationAction[];
  /** Eligible Actions that carry no explicit queue position yet. */
  unpositioned: PlanActivationAction[];
  /**
   * True when the Project still has unfinished Actions in its active Plans,
   * even if none of them can become the pointer yet. False means every Action
   * is done/blocked/deferred, so the Project has genuinely run out of eligible
   * or ineligible work.
   */
  remainingWork: boolean;
}

/**
 * Resolve which Plan and Action a total Arcadia Go transition should activate
 * when the active Plan is absent, complete, or otherwise unable to continue.
 *
 * Reads documents for eligibility (so it can never disagree with dispatch)
 * and the explicit queue for priority (Decision 0048). It writes nothing and
 * expresses no new priority: the queue is the single priority authority, and
 * dependencies, Decisions, and responsibility filter what is eligible without
 * reordering anything.
 */
export function resolvePlanActivation(input: {
  repoRoot: string;
  projectSlug: string;
  positions: Map<string, number>;
  /**
   * Action keys to treat as already finished. Completion resolves the next
   * target from documents as though the Action it just finished were already
   * done on disk, so the completed Action must not be offered as its own
   * successor.
   */
  ignoredActionKeys?: Set<string>;
}): PlanActivationResolution {
  const discovered = discoverDocs(input.repoRoot);
  const project = discovered.docs.find(
    (doc): doc is ProjectDoc => doc.type === "project" && doc.slug.toLowerCase() === input.projectSlug.toLowerCase()
  ) ?? null;

  const base = {
    projectSlug: input.projectSlug,
    activePlan: project?.activePlan ?? null,
    activePlanStatus: null as string | null,
    candidate: null as PlanActivationAction | null,
    ranked: [] as PlanActivationAction[],
    unpositioned: [] as PlanActivationAction[],
    remainingWork: false
  };
  if (!project || project.status !== "active") {
    return { ...base, status: "none", reason: "This Project is not active, so no Plan may be activated for it." };
  }

  const activePlan = project.activePlan
    ? discovered.docs.find((doc): doc is PlanDoc =>
        doc.type === "plan" && doc.project.toLowerCase() === project.slug.toLowerCase()
        && doc.slug.toLowerCase() === project.activePlan!.toLowerCase()) ?? null
    : null;

  // Only `active` Plans are approved to run. `draft` is unapproved, and
  // `complete`/`superseded` are finished — Decision 0048 activates a Plan the
  // operator has already approved, never a draft by queue inference.
  const plans = discovered.docs.filter(
    (doc): doc is PlanDoc =>
      doc.type === "plan" && doc.project.toLowerCase() === project.slug.toLowerCase() && doc.status === "active"
  );

  // A duplicated Action id across active Plans would make readiness answer
  // about whichever Plan it found first. Refuse rather than guess.
  const idCounts = new Map<string, number>();
  for (const plan of plans) for (const action of plan.actions) {
    idCounts.set(action.id, (idCounts.get(action.id) ?? 0) + 1);
  }
  const duplicated = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);

  const eligible: PlanActivationAction[] = [];
  let remainingWork = false;
  for (const plan of plans) {
    for (const action of plan.actions) {
      if (action.status === "done" || action.status === "blocked" || action.status === "deferred") continue;
      if (input.ignoredActionKeys?.has(`${project.slug}/${action.id}`)) continue;
      remainingWork = true;
      if (duplicated.includes(action.id)) continue;
      if (action.responsibility !== "agent" && action.responsibility !== "autonomous") continue;
      const readiness = resolveActionReadiness(input.repoRoot, project.slug, action.id);
      if (readiness.blockers.length > 0 || readiness.operatorQuestion) continue;
      const actionKey = `${project.slug}/${action.id}`;
      eligible.push({
        planSlug: plan.slug,
        planPath: plan.relativePath,
        actionId: action.id,
        actionTitle: action.title,
        actionKey,
        position: input.positions.get(actionKey) ?? null
      });
    }
  }

  if (duplicated.length > 0) {
    return {
      ...base,
      activePlan: project.activePlan,
      activePlanStatus: activePlan?.status ?? null,
      status: "ambiguous",
      remainingWork,
      reason: `Action id ${duplicated.map((id) => `"${id}"`).join(", ")} is not unique across this Project's active Plans, so the queue cannot name one unambiguous successor.`
    };
  }

  const documentRank = new Map<string, number>();
  let rank = 0;
  for (const plan of plans) for (const action of plan.actions) documentRank.set(`${plan.slug}#${action.id}`, rank++);
  const ordered = [...eligible].sort((left, right) =>
    comparePosition(left.position, right.position)
    || (documentRank.get(`${left.planSlug}#${left.actionId}`) ?? 0) - (documentRank.get(`${right.planSlug}#${right.actionId}`) ?? 0)
    || left.actionKey.localeCompare(right.actionKey)
  );
  const positioned = ordered.filter((action) => action.position !== null);
  const unpositioned = ordered.filter((action) => action.position === null);

  const resolved = {
    projectSlug: project.slug,
    activePlan: project.activePlan,
    activePlanStatus: activePlan?.status ?? null,
    ranked: ordered,
    unpositioned,
    remainingWork
  };

  if (ordered.length === 0) {
    return {
      ...base,
      ...resolved,
      status: "none",
      reason: remainingWork
        ? "Every unfinished Action in this Project's active Plans is ineligible (a Decision, question, dependency, or responsibility gate)."
        : "Every Action in this Project's active Plans is done, blocked, or deferred."
    };
  }

  if (positioned.length >= 2 && positioned[0].position !== null && positioned[0].position === positioned[1].position) {
    return {
      ...base,
      ...resolved,
      status: "ambiguous",
      reason: `The explicit queue ranks ${positioned[0].actionKey} and ${positioned[1].actionKey} equally, so no successor is determined.`,
      candidate: positioned[0]
    };
  }

  if (unpositioned.length > 0) {
    // At least one approved Action has never been ordered. Decision 0048 allows
    // a previewed, reversible one-time FIFO seed before selection; the caller
    // runs it, then re-resolves.
    return {
      ...base,
      ...resolved,
      status: "unordered",
      reason: `${unpositioned.length} approved Action${unpositioned.length === 1 ? "" : "s"} have no explicit queue position yet; a FIFO seed is required before automatic Plan selection.`,
      candidate: positioned[0] ?? ordered[0]
    };
  }

  const candidate = positioned[0];
  return {
    ...base,
    ...resolved,
    status: "candidate",
    reason: candidate.planSlug === project.activePlan
      ? `The explicit queue selects ${candidate.actionKey} in the active Plan.`
      : `The explicit queue selects ${candidate.actionKey}, so Plan "${candidate.planSlug}" becomes active.`,
    candidate
  };
}

function comparePosition(left: number | null, right: number | null): number {
  if (left !== null && right !== null) return left - right;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

/**
 * Every approved unfinished Action key the Project's active Plans declare, in
 * the deterministic order the resolver already projects. Used only to seed the
 * explicit queue once (Decision 0048); never to decide priority.
 */
export function projectActionKeys(repoRoot: string, projectSlug: string): string[] {
  const discovered = discoverDocs(repoRoot);
  const project = discovered.docs.find(
    (doc): doc is ProjectDoc => doc.type === "project" && doc.slug.toLowerCase() === projectSlug.toLowerCase()
  );
  if (!project) return [];
  const plans = discovered.docs.filter(
    (doc): doc is PlanDoc =>
      doc.type === "plan" && doc.project.toLowerCase() === projectSlug.toLowerCase() && doc.status === "active"
  );
  const keys: string[] = [];
  for (const plan of plans) {
    for (const action of plan.actions) {
      if (action.status === "done" || action.status === "blocked" || action.status === "deferred") continue;
      keys.push(`${project.slug}/${action.id}`);
    }
  }
  return keys;
}
