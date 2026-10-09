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

/** The longest reason a surface shows, ellipsis included; a longer `why` is cut deterministically. */
export const STEP_REASON_MAX_LENGTH = 300;

/**
 * One line, at most {@link STEP_REASON_MAX_LENGTH} characters. A hand-written
 * Plan may declare `why: |` over several lines or at any length, and every
 * surface prints a reason on a single line.
 */
export function oneLineReason(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > STEP_REASON_MAX_LENGTH
    ? `${collapsed.slice(0, STEP_REASON_MAX_LENGTH - 1).trimEnd()}\u2026`
    : collapsed;
}

/** The author's `why` when there is one, otherwise the derived sentence. */
export function stepReason(declaredWhy: string | null | undefined, derived: string): StepReason {
  const why = declaredWhy ? oneLineReason(declaredWhy) : "";
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
