/**
 * The one ordering rule of production scheduling, as a pure function.
 *
 * Every queued Action belongs to a scheduling tier. Effective order is:
 * highest tier first, then the lowest `queue_position` inside that tier, and
 * an Action never runs before a dependency it declares. Dependencies outrank
 * tiers as well as positions -- a blocker that depends on a planned Action
 * still waits for it -- because the alternative is a queue that says "next"
 * about work that cannot start.
 *
 * Nothing here reads a database or GitHub. The scheduler, the operator-reorder
 * validator and the board projection all call the same function, so there is
 * exactly one place a canonical order can come from.
 */

export type SchedulingClass = "interrupt" | "blocker" | "corrective" | "planned" | "follow_up";

export const SCHEDULING_CLASSES: readonly SchedulingClass[] = ["interrupt", "blocker", "corrective", "planned", "follow_up"];

/** Lower ranks run first. `follow_up` is backlog and never enters the queue. */
export const TIER_RANK: Record<SchedulingClass, number> = {
  interrupt: 0,
  blocker: 1,
  corrective: 2,
  planned: 3,
  follow_up: 4
};

export function isQueuedClass(schedulingClass: SchedulingClass): boolean {
  return schedulingClass !== "follow_up";
}

export interface OrderCandidate {
  key: string;
  /** The Plan this candidate's Action is declared in. */
  plan: string;
  /** This candidate's own bare Action id (unprefixed) -- what a same-Plan `dependsOn` entry, or the `#<action-id>` half of a cross-Plan one, matches against. */
  actionId: string;
  schedulingClass: SchedulingClass;
  /** Persisted `queue_position`; `null` means never positioned. */
  position: number | null;
  /**
   * Ids of Actions this one waits for. A bare id resolves against this
   * candidate's own `plan`; `plan/<slug>#<action-id>` resolves against that
   * Plan instead. An id that resolves to no known Action -- in either form --
   * is never treated as satisfied, so it holds this candidate back rather
   * than releasing it.
   */
  dependsOn: string[];
  done: boolean;
  /** Tie-break for equal or missing positions: plan declaration / discovery order. */
  index: number;
}

const CROSS_PLAN_DEPENDENCY = /^plan\/([^#]+)#(.+)$/;

function planActionKey(plan: string, actionId: string): string {
  return `${plan}\u0000${actionId}`;
}

/**
 * Resolve one `dependsOn` entry to the candidate it names, or `null` when it
 * names no known Action. A bare id is a same-Plan reference; `plan/<slug>#
 * <action-id>` names an Action in another Plan by the same spelling the
 * `complete` Agent Ask intent uses for `target_ref`.
 */
function resolveDependency(
  byPlanAction: Map<string, OrderCandidate>,
  from: OrderCandidate,
  dependency: string
): OrderCandidate | null {
  const cross = CROSS_PLAN_DEPENDENCY.exec(dependency);
  const plan = cross ? cross[1] : from.plan;
  const actionId = cross ? cross[2] : dependency;
  return byPlanAction.get(planActionKey(plan, actionId)) ?? null;
}

/**
 * Canonical order of every unfinished queued candidate: tier, then position,
 * then declaration order -- with each Action held back until every unfinished
 * dependency it names has been emitted. A dependency cycle, or a dependency
 * that never resolves to a known Action, cannot be represented as an order,
 * so the first remaining candidate is emitted once nothing else can proceed,
 * to keep the result total; the document parser refuses same-Plan cycles
 * before they get here.
 */
export function canonicalOrder(candidates: OrderCandidate[]): string[] {
  const live = candidates.filter((candidate) => !candidate.done && isQueuedClass(candidate.schedulingClass));
  const byPlanAction = new Map(candidates.map((candidate) => [planActionKey(candidate.plan, candidate.actionId), candidate]));
  const doneKeys = new Set(candidates.filter((candidate) => candidate.done).map((candidate) => candidate.key));
  const sorted = [...live].sort(compareByPreference);
  const emitted = new Set<string>();
  const result: string[] = [];
  const remaining = [...sorted];

  const isSatisfied = (from: OrderCandidate, dependency: string): boolean => {
    const resolved = resolveDependency(byPlanAction, from, dependency);
    if (!resolved) return false;
    return emitted.has(resolved.key) || doneKeys.has(resolved.key);
  };

  while (remaining.length > 0) {
    const index = remaining.findIndex((candidate) => candidate.dependsOn.every((dependency) => isSatisfied(candidate, dependency)));
    const next = remaining.splice(index < 0 ? 0 : index, 1)[0];
    emitted.add(next.key);
    result.push(next.key);
  }

  return result;
}

function compareByPreference(left: OrderCandidate, right: OrderCandidate): number {
  const tier = TIER_RANK[left.schedulingClass] - TIER_RANK[right.schedulingClass];
  if (tier !== 0) return tier;
  const leftPosition = left.position ?? Number.POSITIVE_INFINITY;
  const rightPosition = right.position ?? Number.POSITIVE_INFINITY;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return left.index - right.index || left.key.localeCompare(right.key);
}

export interface OperatorReorderResult {
  /** Canonical order before the operator's change. */
  before: string[];
  /** The order the operator asked for: the observed board order, with any queued Action missing from the board kept in its prior place. */
  requested: string[];
  /** Canonical order after applying the request and normalizing it. */
  canonical: string[];
  /** The observed order differs from `before`. */
  operatorMoved: boolean;
  /** `canonical` differs from `before`: something must be persisted. */
  changed: boolean;
  /** `canonical` differs from `requested`: part of the request was refused. */
  normalized: boolean;
  /** One plain sentence per refused placement. */
  normalizationReasons: string[];
}

/**
 * Apply an order observed on the operator-facing board. The observed order
 * becomes the requested positions; the canonical rule then restores tier and
 * dependency invariants. Only the difference between requested and canonical
 * is a refusal, and each refusal is explained so it can be logged rather than
 * escalated.
 */
export function applyOperatorOrder(candidates: OrderCandidate[], observed: string[]): OperatorReorderResult {
  const before = canonicalOrder(candidates);
  const queued = new Set(before);
  const seen = new Set<string>();
  const observedKnown = observed.filter((key) => queued.has(key) && !seen.has(key) && (seen.add(key), true));
  const requested = [...observedKnown, ...before.filter((key) => !seen.has(key))];
  const operatorMoved = !sameSequence(before.filter((key) => seen.has(key)), observedKnown);

  const requestedPosition = new Map(requested.map((key, index) => [key, index]));
  const repositioned = candidates.map((candidate) => ({
    ...candidate,
    position: requestedPosition.get(candidate.key) ?? candidate.position
  }));
  const canonical = canonicalOrder(repositioned);
  const normalizationReasons = explainNormalization(repositioned, requested, canonical);

  return {
    before,
    requested,
    canonical,
    operatorMoved,
    changed: !sameSequence(before, canonical),
    normalized: !sameSequence(requested, canonical),
    normalizationReasons
  };
}

function explainNormalization(candidates: OrderCandidate[], requested: string[], canonical: string[]): string[] {
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const byPlanAction = new Map(candidates.map((candidate) => [planActionKey(candidate.plan, candidate.actionId), candidate]));
  const canonicalIndex = new Map(canonical.map((key, index) => [key, index]));
  const reasons: string[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const key = requested[index];
    for (const later of requested.slice(index + 1)) {
      if ((canonicalIndex.get(later) ?? 0) >= (canonicalIndex.get(key) ?? 0)) continue;
      const moved = byKey.get(key);
      const ahead = byKey.get(later);
      if (!moved || !ahead) continue;
      if (dependsTransitively(byPlanAction, moved, ahead.key)) {
        reasons.push(`${key} depends on ${ahead.key}, so it stays behind it.`);
      } else if (TIER_RANK[moved.schedulingClass] > TIER_RANK[ahead.schedulingClass]) {
        reasons.push(`${key} (${moved.schedulingClass}) cannot move ahead of ${ahead.key} (${ahead.schedulingClass}).`);
      }
    }
  }
  return [...new Set(reasons)];
}

function dependsTransitively(
  byPlanAction: Map<string, OrderCandidate>,
  from: OrderCandidate,
  targetKey: string,
  seen = new Set<string>()
): boolean {
  for (const dependency of from.dependsOn) {
    const next = resolveDependency(byPlanAction, from, dependency);
    if (!next || seen.has(next.key)) continue;
    if (next.key === targetKey) return true;
    seen.add(next.key);
    if (dependsTransitively(byPlanAction, next, targetKey, seen)) return true;
  }
  return false;
}

export function sameSequence(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/**
 * The fewest board moves that turn `current` into `desired`: keep the longest
 * subsequence already in the right relative order and move only the rest.
 * Returns each moved key with the key it must follow (`null` = top).
 */
export function minimalMoves(current: string[], desired: string[]): Array<{ key: string; after: string | null }> {
  const desiredIndex = new Map(desired.map((key, index) => [key, index]));
  const sequence = current.filter((key) => desiredIndex.has(key)).map((key) => desiredIndex.get(key)!);
  const keep = new Set(longestIncreasingSubsequence(sequence).map((index) => desired[index]));
  const moves: Array<{ key: string; after: string | null }> = [];
  for (let index = 0; index < desired.length; index += 1) {
    const key = desired[index];
    if (keep.has(key)) continue;
    moves.push({ key, after: index === 0 ? null : desired[index - 1] });
  }
  return moves;
}

function longestIncreasingSubsequence(values: number[]): number[] {
  const tails: number[] = [];
  const tailIndices: number[] = [];
  const previous: number[] = new Array(values.length).fill(-1);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
    tailIndices[low] = index;
    previous[index] = low > 0 ? tailIndices[low - 1] : -1;
  }
  const result: number[] = [];
  let cursor = tailIndices.length > 0 ? tailIndices[tailIndices.length - 1] : -1;
  while (cursor >= 0) {
    result.unshift(values[cursor]);
    cursor = previous[cursor]!;
  }
  return result;
}
