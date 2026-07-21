/**
 * Mission Control spatial-urgency math. Pure functions only — no rendering,
 * no simulation wiring, no React, no Three.js. See
 * docs/plans/mission-control-view/03-urgency-and-force-model.md for the
 * reasoning behind each of these.
 *
 * Domain-specific scoring (e.g. "how does an Orientation entry's priority
 * and due date become a 0..1 urgencyScore") deliberately does NOT live here
 * — that differs per node kind. This module only covers what's generic:
 * mapping an already-computed score to a distance, and how a node's radial
 * anchor strength decays with staleness.
 */

/**
 * Weber-Fechner-consistent distance mapping: equal steps in `urgencyScore`
 * produce equal PERCENTAGE changes in distance, not equal absolute ones —
 * matching how perceived intensity/salience actually scales, and matching
 * how a perspective vanishing point already foreshortens distance visually.
 *
 * `urgencyScore` should be in [0, 1]; 1 = maximally urgent (closest),
 * 0 = minimally urgent (farthest, at/near the horizon).
 */
export function urgencyToDistance(urgencyScore: number, dNear: number, dFar: number): number {
  const u = clamp01(urgencyScore);
  if (dNear <= 0 || dFar <= 0) {
    throw new Error("urgencyToDistance requires dNear and dFar to be positive.");
  }
  return dNear * Math.pow(dFar / dNear, 1 - u);
}

/**
 * A node's radial anchor force should hold it firmly at its
 * urgency-determined distance when fresh, and progressively lose its grip
 * as the node goes stale — letting ambient repulsion from other nodes drift
 * it outward. This is deliberately a force-STRENGTH decay, not a change to
 * the target distance itself (see 03-urgency-and-force-model.md for why
 * that distinction matters): the anchor weakens, the target position it was
 * ever anchored to doesn't move.
 *
 * `ageRatio` = (time since last confirmed) / (staleness threshold for this
 * node's horizon) — i.e. 1.0 exactly at the staleness threshold, 2.0 at the
 * "neglected" point (2x threshold). Returns a multiplier in [minStrength, 1]
 * to apply to the radial force's strength/weight parameter.
 */
export function radialAnchorStrength(ageRatio: number, minStrength = 0.1): number {
  if (ageRatio <= 1) {
    return 1;
  }
  // Linear falloff from full strength at ageRatio=1 to minStrength at
  // ageRatio=2 (the existing "neglected" point, see src/orientation/staleness.ts),
  // then held at minStrength beyond that — a node never loses its anchor
  // entirely, it just drifts.
  const t = clamp01(ageRatio - 1);
  return 1 - t * (1 - minStrength);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
