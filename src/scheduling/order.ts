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
  schedulingClass: SchedulingClass;
  /** Persisted `queue_position`; `null` means never positioned. */
  position: number | null;
  /** Keys of Actions this one waits for. Unknown keys are ignored. */
  dependsOn: string[];
  done: boolean;
  /** Tie-break for equal or missing positions: plan declaration / discovery order. */
  index: number;
}

/**
 * Canonical order of every unfinished queued candidate: tier, then position,
 * then declaration order -- with each Action held back until every unfinished
 * dependency it names has been emitted. A dependency cycle cannot be
 * represented as an order, so the first remaining candidate is emitted to
 * keep the result total; the document parser refuses cycles before they get
 * here.
 */
export function canonicalOrder(candidates: OrderCandidate[]): string[] {
  const live = candidates.filter((candidate) => !candidate.done && isQueuedClass(candidate.schedulingClass));
  const known = new Map(live.map((candidate) => [candidate.key, candidate]));
  const doneKeys = new Set(candidates.filter((candidate) => candidate.done).map((candidate) => candidate.key));
  const sorted = [...live].sort(compareByPreference);
  const emitted = new Set<string>();
  const result: string[] = [];
  const remaining = [...sorted];

  while (remaining.length > 0) {
    const index = remaining.findIndex((candidate) =>
      candidate.dependsOn.every((dependency) => emitted.has(dependency) || doneKeys.has(dependency) || !known.has(dependency))
    );
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
  const canonicalIndex = new Map(canonical.map((key, index) => [key, index]));
  const reasons: string[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const key = requested[index];
    for (const later of requested.slice(index + 1)) {
      if ((canonicalIndex.get(later) ?? 0) >= (canonicalIndex.get(key) ?? 0)) continue;
      const moved = byKey.get(key);
      const ahead = byKey.get(later);
      if (!moved || !ahead) continue;
      if (dependsTransitively(byKey, moved, ahead.key)) {
        reasons.push(`${key} depends on ${ahead.key}, so it stays behind it.`);
      } else if (TIER_RANK[moved.schedulingClass] > TIER_RANK[ahead.schedulingClass]) {
        reasons.push(`${key} (${moved.schedulingClass}) cannot move ahead of ${ahead.key} (${ahead.schedulingClass}).`);
      }
    }
  }
  return [...new Set(reasons)];
}

function dependsTransitively(byKey: Map<string, OrderCandidate>, from: OrderCandidate, target: string, seen = new Set<string>()): boolean {
  for (const dependency of from.dependsOn) {
    if (dependency === target) return true;
    if (seen.has(dependency)) continue;
    seen.add(dependency);
    const next = byKey.get(dependency);
    if (next && dependsTransitively(byKey, next, target, seen)) return true;
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
