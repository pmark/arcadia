/**
 * Why a step is on the route, in one sentence.
 *
 * A plan Action may declare its own `why`. When it does not, the reason is
 * derived from the one structural fact the route already knows: how the step
 * got onto it. No model is consulted; the same documents always yield the same
 * words, and `reasonSource` says which kind the reader is looking at, so a
 * derived sentence is never mistaken for something an author wrote.
 */

export type StepReasonSource = "declared" | "derived";

export interface StepReason {
  reason: string;
  reasonSource: StepReasonSource;
}

/** The author's `why` when there is one, otherwise the derived sentence. */
export function stepReason(declaredWhy: string | null | undefined, derived: string): StepReason {
  const why = declaredWhy?.trim();
  return why ? { reason: why, reasonSource: "declared" } : { reason: derived, reasonSource: "derived" };
}

/** The gate's own Action: finishing it is what clears the gate. */
export function completesGate(gateTitle: string): string {
  return `Completes gate: ${gateTitle}`;
}

/** A prerequisite: the Action that waits on it cannot start first. */
export function unblocks(dependentTitle: string): string {
  return `Unblocks ${dependentTitle}`;
}

/** A split remainder: the rest of the scope a narrowed, finished Action was declared for. */
export function remainderOf(splitParentTitle: string): string {
  return `Remainder of ${splitParentTitle}`;
}
